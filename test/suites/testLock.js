const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  let w3 = web3,
    evmTime,
    maxTime,
    poolInfos;

  before(function () {
    ({ contractAddress, admin, config } = global);

    ({ deployContract, deployInProxy, ethTransact, config } = global);

    ({ getEVMTimestamp, setEVMTimestamp } = global);
  });

  it('Create Lock', async function () {
    maxTime = await global.VotingEscrow.instance.methods.maxTime().call();

    evmTime = getEVMTimestamp();
    let unadjustedUnlockTime = evmTime + 10 * config.timer.WEEK;
    await global.PPI.instance.methods
      .approve(contractAddress.VotingEscrow, global.maxInt)
      .send({ from: admin });

    await global.VotingEscrow.instance.methods
      .createLock(new BigNumber(1e18).toString(10), unadjustedUnlockTime)
      .send({ from: admin });

    // check info
    let userInfo = await global.VotingEscrow.instance.methods
      .userInfo(admin)
      .call();
    let adjustedUnlockTime = new BigNumber(unadjustedUnlockTime)
      .dividedToIntegerBy(config.timer.WEEK)
      .multipliedBy(config.timer.WEEK)
      .toString(10);
    expect(adjustedUnlockTime).to.equal(userInfo.unlockTime);
    expect(new BigNumber(1e18).toString(10)).to.equal(userInfo.amount);
    let block = await w3.eth.getBlock('latest');
    let balance = new BigNumber(userInfo.amount)
      .multipliedBy(adjustedUnlockTime - block.timestamp)
      .dividedToIntegerBy(maxTime)
      .toString(10);
    expect(
      await global.VotingEscrow.instance.methods
        .balanceOf(admin)
        .call({}, 'latest'),
    ).to.equal(balance);
  });

  it('Increase Lock Time', async function () {
    let newUnlockTime = evmTime + 20 * config.timer.WEEK;
    await global.VotingEscrow.instance.methods
      .increaseUnlockTime(newUnlockTime)
      .send({ from: admin });
  });

  it('Increase Lock Amount', async function () {
    await global.VotingEscrow.instance.methods
      .increaseAmount(admin, new BigNumber(1e18).toString(10))
      .send({ from: admin });
  });
};
