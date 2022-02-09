const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  before(function () {
    ({ contractAddress, admin } = global);

    ({ deployContract, deployInProxy, ethTransact } = global);
  });

  it('Deploy Swappi Factory', async function () {
    let receipt = await deployContract(global.SwappiFactory, [admin]);
    contractAddress.SwappiFactory = receipt.contractAddress.toLowerCase();
    SwappiFactory.instance.options.address = contractAddress.SwappiFactory;

    // set fee
    await SwappiFactory.instance.methods
      .setFeeTo(global.config.feeAddr)
      .send({ from: admin });
  });

  it('Create Pairs, Add Liquidity', async function () {
    let price = {
      ETH: 4000,
      BTC: 40000,
      WCFX: 100,
      USDT: 1,
    };
    let tokens = Object.keys(price);
    for (let i = 0; i < tokens.length; ++i) {
      for (let j = i + 1; j < tokens.length; ++j) {
        // create pair
        await global.SwappiFactory.instance.methods
          .createPair(contractAddress[tokens[i]], contractAddress[tokens[j]])
          .send({ from: admin });

        let pair = await global.SwappiFactory.instance.methods
          .getPair(contractAddress[tokens[i]], contractAddress[tokens[j]])
          .call();
        // send token_i
        await global[tokens[i]].instance.methods
          .transfer(
            pair,
            new BigNumber(1e18)
              .multipliedBy(100000 / price[tokens[i]])
              .toString(10),
          )
          .send({ from: admin });
        // send token_j
        await global[tokens[j]].instance.methods
          .transfer(
            pair,
            new BigNumber(1e18)
              .multipliedBy(100000 / price[tokens[j]])
              .toString(10),
          )
          .send({ from: admin });
        // mint lp tokens
        global.SwappiPair.instance.options.address = pair;
        await global.SwappiPair.instance.methods
          .mint(admin)
          .send({ from: admin });
      }
    }
  });
};
