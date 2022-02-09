const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  let w3 = web3,
    evmTime,
    poolInfos;

  before(function () {
    ({ contractAddress, admin, config } = global);

    ({ deployContract, deployInProxy, ethTransact, config } = global);

    ({ getEVMTimestamp, setEVMTimestamp } = global);
  });

  it('Deposit', async function () {
    poolInfos = await global.FarmController.instance.methods
      .getPoolInfo(0)
      .call();
    let token = poolInfos[0].token;
    global.SwappiPair.instance.options.address = token;
    let lpBefore = await global.SwappiPair.instance.methods
      .balanceOf(admin)
      .call();
    await global.SwappiPair.instance.methods
      .approve(contractAddress.FarmController, global.maxInt)
      .send({ from: admin });
    await global.FarmController.instance.methods
      .deposit(0, '10000000')
      .send({ from: admin });
    let userInfo = await global.FarmController.instance.methods
      .userInfo(0, admin)
      .call();
    expect(userInfo.amount).to.equal('10000000');
    expect(userInfo.workingSupply).to.equal('3300000');
    let lpAfter = await global.SwappiPair.instance.methods
      .balanceOf(admin)
      .call();
    expect(new BigNumber(lpBefore).minus(lpAfter).toString(10)).to.equal(
      '10000000',
    );
  });

  it('PPIRate Reward Check', async function () {
    evmTime = config.startTime + 100;
    let PPIReward = new BigNumber(evmTime)
      .minus(config.startTime)
      .multipliedBy(config.rates[0][1])
      .toString(10);
    expect(
      await global.PPIRate.instance.methods
        .calculateReward(config.startTime, evmTime)
        .call(),
    ).to.equal(PPIReward);
    // TODO: more complicate case
  });

  it('withdraw', async function () {
    evmTime = config.startTime + 100;
    await network.provider.send('evm_setNextBlockTimestamp', [evmTime]);

    let lpBefore = await global.SwappiPair.instance.methods
      .balanceOf(admin)
      .call();
    // withdraw
    await global.FarmController.instance.methods
      .withdraw(0, '5000000')
      .send({ from: admin });

    // check pool info
    poolInfos = await global.FarmController.instance.methods
      .getPoolInfo(0)
      .call();
    let totalReward = await global.PPIRate.instance.methods
      .calculateReward(config.startTime, evmTime)
      .call();
    let rewardOfPool0 = new BigNumber(totalReward)
      .multipliedBy(poolInfos[0].allocPoint)
      .dividedToIntegerBy(
        await global.FarmController.instance.methods.totalAllocPoint().call(),
      )
      .multipliedBy(50)
      .dividedToIntegerBy(100)
      .toString(10);
    let accRewardPerShare = new BigNumber(rewardOfPool0)
      .multipliedBy(1e18)
      .dividedToIntegerBy('3300000')
      .toString(10);
    expect(poolInfos[0].accRewardPerShare).to.equal(accRewardPerShare);

    // check user balance
    let lpAfter = await global.SwappiPair.instance.methods
      .balanceOf(admin)
      .call();
    expect(new BigNumber(lpAfter).minus(lpBefore).toString(10)).to.equal(
      '5000000',
    );
    let userInfo = await global.FarmController.instance.methods
      .userInfo(0, admin)
      .call();
    expect(userInfo.amount).to.equal('5000000');
    expect(userInfo.workingSupply).to.equal('1650000');

    let balance = await global.PPI.instance.methods.balanceOf(admin).call();
    let reward = new BigNumber(accRewardPerShare)
      .multipliedBy('3300000')
      .dividedToIntegerBy(1e18)
      .toString(10);
    expect(balance).to.equal(reward);
    setEVMTimestamp(evmTime);
  });
};
