const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  before(function () {
    ({ contractAddress, admin } = global);

    ({ deployContract, deployInProxy, ethTransact } = global);
  });

  it(`Deploy Faucet Tokens`, async function () {
    let tokens = ['BTC', 'ETH', 'USDT'];
    for (let i = 0; i < tokens.length; ++i) {
      // deploy
      let receipt = await deployContract(global[tokens[i]], [
        tokens[i],
        tokens[i],
        18,
      ]);
      contractAddress[tokens[i]] = receipt.contractAddress.toLowerCase();
      global[tokens[i]].instance.options.address = contractAddress[tokens[i]];

      // mint
      let data = global[tokens[i]].instance.methods
        .mint(admin, new BigNumber(1e27).toString(10))
        .encodeABI();
      await ethTransact(data, contractAddress[tokens[i]]);
    }
  });

  it(`Deploy Wrapped CFX`, async function () {
    let receipt = await deployContract(global.WCFX, []);
    contractAddress.WCFX = receipt.contractAddress.toLowerCase();
    global.WCFX.instance.options.address = contractAddress.WCFX;

    await global.WCFX.instance.methods.deposit().send({
      from: admin,
      value: new BigNumber(1e22).toString(10),
    });

    expect(await global.WCFX.instance.methods.balanceOf(admin).call()).to.equal(
      new BigNumber(1e22).toString(10),
    );
  });
};
