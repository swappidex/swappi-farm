const setupGlobals = require('./setupGlobals');
const deployTokens = require('./suites/deployTokens');
const deploySwappi = require('./suites/deploySwappi');
const deployFarm = require('./suites/deployFarm');
const testFarm = require('./suites/testFarm');
const testLock = require('./suites/testLock');

describe('Swappi Farm Contracts', function () {
  let w3 = web3;

  before(async () => {
    await setupGlobals();
  });
  describe('Deploy tokens', deployTokens.bind(this));
  describe('Deploy Swappi', deploySwappi.bind(this));
  describe('Deploy Farm', deployFarm.bind(this));
  describe('Test Farm', testFarm.bind(this));
  describe('Test Lock', testLock.bind(this));
});
