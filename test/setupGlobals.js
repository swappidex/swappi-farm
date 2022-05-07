const fs = require('fs');

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const timer = { SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, YEAR };

function loadContracts(global, w3) {
  let path = __dirname + '/../artifacts/contracts';
  let resources = __dirname + '/resources';
  let contracts = {
    SwappiFactory: `${resources}/SwappiFactory.json`,
    SwappiPair: `${resources}/SwappiPair.json`,
    ETH: `${resources}/FaucetToken.json`,
    BTC: `${resources}/FaucetToken.json`,
    USDT: `${resources}/FaucetToken.json`,
    WCFX: `${resources}/WCFX.json`,

    ERC20: `${path}/erc20/ERC20.sol/ERC20.json`,
    FarmController: `${path}/FarmController.sol/FarmController.json`,
    PPIRate: `${path}/PPIRate.sol/PPIRate.json`,
    PPI: `${path}/PPIToken.sol/PPIToken.json`,
    proxy: `${path}/proxy/BeaconProxy.sol/BeaconProxy.json`,
    beacon: `${path}/proxy/UpgradeableBeacon.sol/UpgradeableBeacon.json`,
    VotingEscrow: `${path}/VotingEscrow.sol/VotingEscrow.json`,
    MultiRewardPool: `${path}/MultiRewardPool.sol/MultiRewardPool.json`,
  };
  let keys = Object.keys(contracts);
  for (let i = 0; i < keys.length; ++i) {
    global[keys[i]] = JSON.parse(fs.readFileSync(contracts[keys[i]]));
    global[keys[i]].instance = new w3.eth.Contract(global[keys[i]].abi);
  }
}

module.exports = async function () {
  const BigNumber = require('bignumber.js');
  let w3 = web3;

  let contractAddress = {};
  let accounts = await w3.eth.getAccounts();
  let admin = accounts[0];
  let nonce = await w3.eth.getTransactionCount(admin);

  loadContracts(global, w3);

  global.accounts = accounts;
  global.contractAddress = contractAddress;
  global.admin = admin;
  global.nonce = nonce;

  global.maxInt =
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  global.addr0 = '0x0000000000000000000000000000000000000000';
  global.unit = '1000000000000000000';
  global.config = {
    feeAddr: '0x0000000000000000000000000000000000000001',
    treasuryAddr: '0x0000000000000000000000000000000000000002',
    marketAddr: '0x0000000000000000000000000000000000000003',
    devAddr: '0x0000000000000000000000000000000000000004',

    startTime: Math.floor(Date.now() / 1000) + 200,

    timer: timer,

    releaseRate: [
      '53680000',
      '48800000',
      '43920000',
      '39040000',
      '34160000',
      '29280000',
      '26840000',
      '24400000',
      '21960000',
      '19520000',
      '15616000',
      '14640000',
      '13664000',
      '12688000',
      '11712000',
      '10736000',
      '9760000',
      '8784000',
      '7808000',
      '6832000',
      '5856000',
      '4880000',
      '3904000',
      '2928000',
      '2684000',
      '2440000',
      '2196000',
      '1952000',
      '1708000',
      '1464000',
      '1220000',
      '976000',
      '732000',
      '488000',
      '390400',
      '341600',
    ],
  };

  // helper functions
  let startIndex = 1;

  global.getNewTestUsers = function (count) {
    if (startIndex + count > accounts.length) {
      console.log('Not enough test users!');
      return [];
    }
    let users = [];
    for (let i = startIndex; i < startIndex + count; i++) {
      users.push(accounts[i]);
    }
    startIndex += count;
    return users;
  };

  global.getNonce = async function () {
    return await w3.eth.getTransactionCount(admin);
  };

  global.ethTransact = async function (data, to = undefined, opts = {}) {
    let nonce = await getNonce();
    let gasPrice = new BigNumber(await w3.eth.getGasPrice());
    gasPrice = gasPrice.multipliedBy(1.05).integerValue().toString(10);
    let txParams = {
      from: admin,
      to: to,
      nonce: nonce,
      value: opts.value ? w3.utils.toHex(opts.value) : 0,
      gasPrice: gasPrice,
      data: data,
    };
    if (opts.gas) {
      txParams.gas = opts.gas;
    } else {
      txParams.gas = new BigNumber(await w3.eth.estimateGas(txParams))
        .multipliedBy(1.5)
        .integerValue();
      if (txParams.gas.isLessThan(500000)) txParams.gas = new BigNumber(500000);
      txParams.gas = txParams.gas.toString(10);
    }
    let receipt = await w3.eth.sendTransaction(txParams);
    if (!receipt.status) throw new Error(`transaction failed`);

    return receipt;
  };

  global.deployContract = async function (contract, arguments, opts = {}) {
    let data = contract.instance
      .deploy({
        data: contract.bytecode,
        arguments,
      })
      .encodeABI();

    // returns receipt
    return await ethTransact(data, undefined, opts);
  };

  global.deployInProxy = async function (contract, arguments, name) {
    // deploy implementation
    let receipt = await deployContract(contract, arguments);
    let originalContractAddress = receipt.contractAddress.toLowerCase();
    contractAddress[`${name}Impl`] = originalContractAddress;

    // deploy beacon
    receipt = await deployContract(beacon, [originalContractAddress]);
    let beaconAddress = receipt.contractAddress.toLowerCase();

    // deploy proxy
    receipt = await deployContract(proxy, [beaconAddress, '0x']);
    let contractProxyAddress = receipt.contractAddress.toLowerCase();
    contractAddress[`${name}`] = contractProxyAddress;

    return { originalContractAddress, contractProxyAddress };
  };

  // program execution agnostic timestamp
  // delay initialization
  // when using it, ALWAYS ONLY increment this variable
  global.timestamp = null;

  global.setEVMTimestamp = function (newTimestamp) {
    global.timestamp = newTimestamp;
  };

  global.expectRevert = async (promise, reason) => {
    let failed = false;
    try {
      await promise;
    } catch (e) {
      failed = true;
      let revertMsg = undefined;
      if (
        e.message.startsWith(
          `VM Exception while processing transaction: reverted with reason string '`,
        )
      ) {
        revertMsg = e.message.slice(72, e.message.length - 1);
      }
      if (
        e.message.startsWith(
          `Returned error: VM Exception while processing transaction: revert with reason "`,
        )
      ) {
        revertMsg = e.message.slice(79, e.message.length - 1);
      }
      expect(revertMsg).to.equal(reason);
    }
    expect(failed).to.equal(true);
  };

  global.getEVMTimestamp = function () {
    if (global.timestamp) {
      return global.timestamp;
    }

    // initialize global.timestamp when first called
    return Math.floor(Date.now() / 1000);
  };
};
