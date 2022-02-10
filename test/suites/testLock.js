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
    return userInfo;
  }

  before(function () {
    ({ contractAddress, admin, config } = global);

    ({ deployContract, deployInProxy, ethTransact, config } = global);

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
    dummy = global.getNewTestUsers(1)[0];
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
        evmTime + 40 * config.timer.WEEK,
      )
      .send({ from: dummy });

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

    setEVMTimestamp(evmTime);
  });
};
