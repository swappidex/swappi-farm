const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  let w3 = web3,
    evmTime,
    maxTime,
    poolInfos;

  let dummy;

  async function checkUser(user) {
    let userInfo = await global.VotingEscrow.instance.methods
      .userInfo(user)
      .call();
    let block = await w3.eth.getBlock('latest');
    let balance = '0';
    if (userInfo.unlockTime >= block.timestamp) {
      balance = new BigNumber(userInfo.amount)
        .multipliedBy(userInfo.unlockTime - block.timestamp)
        .dividedToIntegerBy(maxTime)
        .toString(10);
    }
    expect(
      await global.VotingEscrow.instance.methods
        .balanceOf(user)
        .call({}, 'latest'),
    ).to.equal(balance);
    userInfo.balance = balance;
    return userInfo;
  }

  before(function () {
    ({ contractAddress, admin, config } = global);

    ({
      deployContract,
      deployInProxy,
      expectRevert,
      ethTransact,
      config,
    } = global);

    ({ getEVMTimestamp, setEVMTimestamp } = global);
  });

  it('Create Lock', async function () {
    maxTime = await global.VotingEscrow.instance.methods.maxTime().call();

    evmTime = getEVMTimestamp();
    if (evmTime % config.timer.WEEK === 0) ++evmTime;
    let unadjustedUnlockTime = evmTime + 10 * config.timer.WEEK;
    await global.PPI.instance.methods
      .approve(contractAddress.VotingEscrow, global.maxInt)
      .send({ from: admin });

    await global.VotingEscrow.instance.methods
      .createLock(new BigNumber(1e18).toString(10), unadjustedUnlockTime)
      .send({ from: admin });

    // check info
    let userInfo = await checkUser(admin);
    let adjustedUnlockTime = new BigNumber(unadjustedUnlockTime)
      .dividedToIntegerBy(config.timer.WEEK)
      .multipliedBy(config.timer.WEEK)
      .toString(10);
    expect(adjustedUnlockTime).to.equal(userInfo.unlockTime);
    expect(new BigNumber(1e18).toString(10)).to.equal(userInfo.amount);
    expect(
      await global.VotingEscrow.instance.methods
        .unlockSchedule(adjustedUnlockTime)
        .call(),
    ).to.equal(userInfo.amount);
  });

  it('Increase Lock Time', async function () {
    let newUnlockTime = evmTime + 20 * config.timer.WEEK;
    await global.VotingEscrow.instance.methods
      .increaseUnlockTime(newUnlockTime)
      .send({ from: admin });
    let userInfo = await checkUser(admin);
    let adjustedUnlockTime = new BigNumber(newUnlockTime)
      .dividedToIntegerBy(config.timer.WEEK)
      .multipliedBy(config.timer.WEEK)
      .toString(10);
    expect(adjustedUnlockTime).to.equal(userInfo.unlockTime);
    expect(
      await global.VotingEscrow.instance.methods
        .unlockSchedule(adjustedUnlockTime)
        .call(),
    ).to.equal(userInfo.amount);
  });

  it('Increase Lock Amount', async function () {
    await global.VotingEscrow.instance.methods
      .increaseAmount(admin, new BigNumber(1e18).toString(10))
      .send({ from: admin });
    let userInfo = await checkUser(admin);
    expect(new BigNumber(2e18).toString(10)).to.equal(userInfo.amount);
    expect(
      await global.VotingEscrow.instance.methods
        .unlockSchedule(userInfo.unlockTime)
        .call(),
    ).to.equal(userInfo.amount);
    let diff = new BigNumber(
      await global.VotingEscrow.instance.methods.totalSupply().call(),
    )
      .minus(await global.VotingEscrow.instance.methods.balanceOf(admin).call())
      .toNumber();
    expect(diff >= 0 && diff <= 3).to.equal(true);
  });

  it('Create Dummy', async function () {
    dummy = global.dummy;
    await global.PPI.instance.methods
      .transfer(dummy, new BigNumber(1e19).toString(10))
      .send({ from: admin });
    await global.PPI.instance.methods
      .approve(contractAddress.VotingEscrow, global.maxInt)
      .send({ from: dummy });
  });

  it('Apply Boost, Dummy Lock', async function () {
    await network.provider.send('evm_setNextBlockTimestamp', [
      evmTime + 2 * config.timer.WEEK,
    ]);

    let t = new BigNumber(evmTime)
      .dividedToIntegerBy(config.timer.WEEK)
      .multipliedBy(config.timer.WEEK)
      .toNumber();
    // check balance at timestamp
    let userInfo = await checkUser(admin);
    let b = await global.VotingEscrow.instance.methods
      .balanceOfAtTimestamp(admin, t + config.timer.WEEK)
      .call();
    expect(b).to.equal(
      await global.VotingEscrow.instance.methods
        .totalSupplyAtTimestamp(t + config.timer.WEEK)
        .call(),
    );
    expect(b).to.equal(
      new BigNumber(userInfo.unlockTime - (t + config.timer.WEEK))
        .multipliedBy(userInfo.amount)
        .dividedToIntegerBy(maxTime)
        .toString(10),
    );

    // apply boost
    await global.FarmController.instance.methods
      .deposit(0, 0)
      .send({ from: admin });

    // dummy lock, trigger _checkpoint()
    await global.VotingEscrow.instance.methods
      .createLock(
        new BigNumber(2e18).toString(10),
        Number(userInfo.unlockTime) + 10 * config.timer.WEEK,
      )
      .send({ from: dummy });

    expect(
      await global.VotingEscrow.instance.methods
        .unlockSchedule(Number(userInfo.unlockTime) + 10 * config.timer.WEEK)
        .call(),
    ).to.equal(new BigNumber(2e18).toString(10));

    userInfo = await checkUser(admin);
    let diff = new BigNumber(
      await global.VotingEscrow.instance.methods
        .historySupply(t + config.timer.WEEK)
        .call(),
    )
      .minus(b)
      .toNumber();
    expect(diff >= 0 && diff <= 3).to.equal(true);

    // check working supply
    expect(
      (await global.FarmController.instance.methods.userInfo(0, admin).call())
        .workingSupply,
    ).to.equal('4999999');

    evmTime = evmTime + 2 * config.timer.WEEK;
  });

  it('refresh boost, kick', async function () {
    await network.provider.send('evm_setNextBlockTimestamp', [
      evmTime + 5 * config.timer.WEEK,
    ]);
    // a irrelevant transaction
    await global.BTC.instance.methods
      .mint(admin, new BigNumber(1e27).toString(10))
      .send({ from: admin });
    // check working supply
    expect(
      (await global.FarmController.instance.methods.userInfo(0, admin).call())
        .workingSupply,
    ).to.equal('4999999');

    // apply boost
    await global.FarmController.instance.methods
      .deposit(0, 0)
      .send({ from: admin });

    let adminInfo = await checkUser(admin);
    let totalSupply = await VotingEscrow.instance.methods.totalSupply().call();

    // check working supply
    let w = (
      await global.FarmController.instance.methods.userInfo(0, admin).call()
    ).workingSupply;
    expect(w).to.equal(
      new BigNumber('5000000')
        .multipliedBy(33)
        .dividedToIntegerBy(100)
        .plus(
          new BigNumber(
            (
              await global.FarmController.instance.methods.poolInfo(0).call()
            ).totalSupply,
          )
            .multipliedBy(adminInfo.balance)
            .dividedToIntegerBy(totalSupply)
            .multipliedBy(67)
            .dividedToIntegerBy(100),
        )
        .toString(10),
    );
    // try kick but fail
    await expectRevert(
      global.FarmController.instance.methods
        .kick(0, admin)
        .send({ from: dummy }),
      'FarmController: user locked balance is not zero',
    );
    // try withdraw but fail
    await expectRevert(
      global.VotingEscrow.instance.methods.withdraw().send({ from: admin }),
      'VotingEscrow: The lock is not expired',
    );

    await network.provider.send('evm_setNextBlockTimestamp', [
      evmTime + 18 * config.timer.WEEK,
    ]);
    // a irrelevant transaction
    await global.BTC.instance.methods
      .mint(admin, new BigNumber(1e27).toString(10))
      .send({ from: admin });
    // check balance
    adminInfo = await checkUser(admin);
    expect(adminInfo.balance).to.equal('0');
    // check working supply
    expect(
      (await global.FarmController.instance.methods.userInfo(0, admin).call())
        .workingSupply,
    ).to.equal(w);
    // kick
    await global.FarmController.instance.methods
      .kick(0, admin)
      .send({ from: dummy });
    expect(
      (await global.FarmController.instance.methods.userInfo(0, admin).call())
        .workingSupply,
    ).to.equal('1650000');
    // try kick again but fail
    await expectRevert(
      global.FarmController.instance.methods
        .kick(0, admin)
        .send({ from: dummy }),
      'FarmController: user working supply is up-to-date',
    );
  });

  it('withdraw', async function () {
    let balanceBefore = await global.PPI.instance.methods
      .balanceOf(admin)
      .call();
    await global.VotingEscrow.instance.methods.withdraw().send({ from: admin });
    let balanceAfter = await global.PPI.instance.methods
      .balanceOf(admin)
      .call();
    expect(
      new BigNumber(balanceAfter).minus(balanceBefore).toString(10),
    ).to.equal(new BigNumber(2e18).toString(10));
    let adminInfo = await checkUser(admin);
    expect(adminInfo.amount).to.equal('0');
  });
};
