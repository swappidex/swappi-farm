const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  let w3 = web3;
  before(function () {
    ({ contractAddress, admin } = global);

    ({ deployContract, deployInProxy, ethTransact, config } = global);
  });

  it('Deploy PPI', async function () {
    let receipt = await deployContract(global.PPI, []);
    contractAddress.PPI = receipt.contractAddress.toLowerCase();
    global.PPI.instance.options.address = contractAddress.PPI;
  });

  it('Deploy Voting Escrow', async function () {
    await deployInProxy(global.VotingEscrow, [], 'VotingEscrow');
    global.VotingEscrow.instance.options.address = contractAddress.VotingEscrow;

    // initialize
    await global.VotingEscrow.instance.methods
      .initialize('Vote-escrowed PPI', 'vePPI', 18, contractAddress.PPI)
      .send({ from: admin });
  });

  it('Deploy PPI Rate', async function () {
    let receipt = await deployContract(global.PPIRate, []);
    contractAddress.PPIRate = receipt.contractAddress.toLowerCase();
    global.PPIRate.instance.options.address = contractAddress.PPIRate;

    // initialize
    let rates = [];
    for (let i = 0; i < config.releaseRate.length; ++i) {
      let t = i * config.timer.MONTH + config.startTime;
      let rate = new BigNumber(config.releaseRate[i])
        .multipliedBy(1e18)
        .dividedToIntegerBy(config.timer.MONTH)
        .toString(10);
      rates.push([t, rate]);
    }
    rates.push([
      config.releaseRate.length * config.timer.MONTH + config.startTime,
      0,
    ]);
    config.rates = rates;
    await PPIRate.instance.methods.initialize(rates).send({ from: admin });
  });

  it('Deploy Farm Controller', async function () {
    await deployInProxy(global.FarmController, [], 'FarmController');
    global.FarmController.instance.options.address =
      contractAddress.FarmController;

    // initialize
    await global.FarmController.instance.methods
      .initialize(
        config.treasuryAddr,
        config.marketAddr,
        config.devAddr,
        contractAddress.VotingEscrow,
        contractAddress.PPIRate,
        contractAddress.PPI,
        config.startTime,
        await global.SwappiFactory.instance.methods
          .getPair(contractAddress.ETH, contractAddress.USDT)
          .call(), // first pool
      )
      .send({ from: admin });
  });

  it('move ownership of PPI to FarmController', async function () {
    await global.PPI.instance.methods
      .transferOwnership(contractAddress.FarmController)
      .send({ from: admin });
  });

  it('add WCFX/ETH LP pool', async function () {
    await global.FarmController.instance.methods
      .add(
        500,
        await global.SwappiFactory.instance.methods
          .getPair(contractAddress.ETH, contractAddress.WCFX)
          .call(),
        config.startTime,
        true,
      )
      .send({ from: admin });

    expect(
      await global.FarmController.instance.methods.poolLength().call(),
    ).to.equal('2');
  });
};
