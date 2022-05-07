const { expect } = require('chai');
const BigNumber = require('bignumber.js');

module.exports = function () {
  let w3 = web3;
  let startTime, lp;

  before(function () {
    ({ contractAddress, admin } = global);

    ({ deployContract, deployInProxy, ethTransact, config } = global);
  });

  it('Deploy Multi Reward Pool', async function () {
    await deployInProxy(global.MultiRewardPool, [], 'MultiRewardPool');
    global.MultiRewardPool.instance.options.address =
      contractAddress.MultiRewardPool;

    // initialize
    await global.MultiRewardPool.instance.methods
      .initialize()
      .send({ from: admin });
  });

  it('add ETH/BTC LP pool', async function () {
    // reward 4000 u, 1 eth
    await global.USDT.instance.methods
      .approve(
        contractAddress.MultiRewardPool,
        new BigNumber(4e21).toString(10),
      )
      .send({ from: admin });
    await global.ETH.instance.methods
      .approve(
        contractAddress.MultiRewardPool,
        new BigNumber(1e18).toString(10),
      )
      .send({ from: admin });

    (lp = await global.SwappiFactory.instance.methods
      .getPair(contractAddress.ETH, contractAddress.WCFX)
      .call()),
      await global.MultiRewardPool.instance.methods
        .add(
          lp,
          [contractAddress.USDT, contractAddress.ETH],
          [new BigNumber(4e21).toString(10), new BigNumber(1e18).toString(10)],
          0,
          config.timer.DAY * 10,
        )
        .send({ from: admin });

    expect(
      await global.MultiRewardPool.instance.methods.poolLength().call(),
    ).to.equal('1');

    let pool = (
      await global.MultiRewardPool.instance.methods.getPoolInfo(0).call()
    )[0];
    expect(Number(pool.endTime) - Number(pool.lastRewardTime)).to.equal(
      config.timer.DAY * 10,
    );
    startTime = Number(pool.lastRewardTime);
  });

  it('stake lp', async function () {
    global.SwappiPair.instance.options.address = lp;

    let ethBefore = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    );
    let usdtBefore = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    );

    // stake
    await global.SwappiPair.instance.methods
      .approve(
        contractAddress.MultiRewardPool,
        new BigNumber(2e18).toString(10),
      )
      .send({ from: admin });
    await network.provider.send('evm_setNextBlockTimestamp', [
      startTime + config.timer.DAY,
    ]);
    await global.MultiRewardPool.instance.methods
      .deposit(0, new BigNumber(1e18).toString(10))
      .send({ from: admin });

    // check refund to sponsor
    let distributedETH = new BigNumber(1e18)
      .minus(
        await global.ETH.instance.methods
          .balanceOf(contractAddress.MultiRewardPool)
          .call(),
      )
      .toString(10);
    let distributedUSDT = new BigNumber(4e21)
      .minus(
        await global.USDT.instance.methods
          .balanceOf(contractAddress.MultiRewardPool)
          .call(),
      )
      .toString(10);

    expect(
      new BigNumber(1e18)
        .dividedToIntegerBy(config.timer.DAY * 10)
        .multipliedBy(config.timer.DAY)
        .toString(10),
    ).to.equal(distributedETH);
    expect(
      new BigNumber(4e21)
        .dividedToIntegerBy(config.timer.DAY * 10)
        .multipliedBy(config.timer.DAY)
        .toString(10),
    ).to.equal(distributedUSDT);

    let ethReceived = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    )
      .minus(ethBefore)
      .toString(10);
    let usdtReceived = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    )
      .minus(usdtBefore)
      .toString(10);

    expect(ethReceived).to.equal(distributedETH);
    expect(usdtReceived).to.equal(distributedUSDT);

    let user = await global.MultiRewardPool.instance.methods
      .userInfo(0, admin)
      .call();
    expect(user).to.equal(new BigNumber(1e18).toString(10));
  });

  it('claim', async function () {
    await network.provider.send('evm_setNextBlockTimestamp', [
      startTime + 5 * config.timer.DAY,
    ]);

    let ethBefore = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    );
    let usdtBefore = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    );

    await global.MultiRewardPool.instance.methods
      .deposit(0, '0')
      .send({ from: admin });

    let ethReceived = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    )
      .minus(ethBefore)
      .toString(10);
    let usdtReceived = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    )
      .minus(usdtBefore)
      .toString(10);

    expect(
      new BigNumber(1e18)
        .dividedToIntegerBy(config.timer.DAY * 10)
        .multipliedBy(4 * config.timer.DAY)
        .toString(10),
    ).to.equal(ethReceived);
    expect(
      new BigNumber(4e21)
        .dividedToIntegerBy(config.timer.DAY * 10)
        .multipliedBy(4 * config.timer.DAY)
        .toString(10),
    ).to.equal(usdtReceived);
  });

  it('withdraw after end time', async function () {
    await network.provider.send('evm_setNextBlockTimestamp', [
      startTime + 100 * config.timer.DAY,
    ]);

    let ethBefore = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    );
    let usdtBefore = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    );
    let lpBefore = new BigNumber(
      await global.SwappiPair.instance.methods.balanceOf(admin).call(),
    );

    await global.MultiRewardPool.instance.methods
      .withdraw(0, new BigNumber(1e18).toString(10))
      .send({ from: admin });

    let ethReceived = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    )
      .minus(ethBefore)
      .toString(10);
    let usdtReceived = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    )
      .minus(usdtBefore)
      .toString(10);
    let lpReceived = new BigNumber(
      await global.SwappiPair.instance.methods.balanceOf(admin).call(),
    )
      .minus(lpBefore)
      .toString(10);

    expect(lpReceived).to.equal(new BigNumber(1e18).toString(10));
    expect(
      new BigNumber(1e18)
        .dividedToIntegerBy(config.timer.DAY * 10)
        .multipliedBy(5 * config.timer.DAY)
        .toString(10),
    ).to.equal(ethReceived);
    expect(
      new BigNumber(4e21)
        .dividedToIntegerBy(config.timer.DAY * 10)
        .multipliedBy(5 * config.timer.DAY)
        .toString(10),
    ).to.equal(usdtReceived);

    let pool = (
      await global.MultiRewardPool.instance.methods.getPoolInfo(0).call()
    )[0];
    expect(pool.endTime).to.equal(pool.lastRewardTime);
    let user = await global.MultiRewardPool.instance.methods
      .userInfo(0, admin)
      .call();
    expect(user).to.equal(new BigNumber(0).toString(10));
  });

  it('try deposit again', async function () {
    let ethBefore = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    );
    let usdtBefore = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    );
    let lpBefore = new BigNumber(
      await global.SwappiPair.instance.methods.balanceOf(admin).call(),
    );

    await global.MultiRewardPool.instance.methods
      .deposit(0, new BigNumber(1e18).toString(10))
      .send({ from: admin });

    let user = await global.MultiRewardPool.instance.methods
      .userInfo(0, admin)
      .call();
    expect(user).to.equal(new BigNumber(1e18).toString(10));

    await network.provider.send('evm_setNextBlockTimestamp', [
      startTime + 120 * config.timer.DAY,
    ]);

    await global.MultiRewardPool.instance.methods
      .withdraw(0, new BigNumber(1e18).toString(10))
      .send({ from: admin });

    user = await global.MultiRewardPool.instance.methods
      .userInfo(0, admin)
      .call();
    expect(user).to.equal(new BigNumber(0).toString(10));

    let ethReceived = new BigNumber(
      await global.ETH.instance.methods.balanceOf(admin).call(),
    )
      .minus(ethBefore)
      .toString(10);
    let usdtReceived = new BigNumber(
      await global.USDT.instance.methods.balanceOf(admin).call(),
    )
      .minus(usdtBefore)
      .toString(10);
    let lpReceived = new BigNumber(
      await global.SwappiPair.instance.methods.balanceOf(admin).call(),
    )
      .minus(lpBefore)
      .toString(10);

    expect(lpReceived).to.equal('0');
    expect('0').to.equal(ethReceived);
    expect('0').to.equal(usdtReceived);

    let pool = (
      await global.MultiRewardPool.instance.methods.getPoolInfo(0).call()
    )[0];
    expect(pool.endTime).to.equal(pool.lastRewardTime);
  });
};
