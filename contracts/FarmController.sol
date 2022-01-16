// SPDX-License-Identifier: MIT
pragma solidity 0.8.2;

import "./interfaces/IERC20.sol";
import "./libraries/SafeERC20.sol";

import "./CakeToken.sol";
import "./VotingEscrow.sol";
import "./utils/NeedInitialize.sol";
import "./roles/WhitelistedRole.sol";

contract FarmController is NeedInitialize, WhitelistedRole {
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many tokens the user has provided.
        uint256 workingSupply; // boosted user share.
        uint256 rewardPerShare; // Accumulated reward per share.
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 token; // Address of token contract.
        uint256 allocPoint; // How many allocation points assigned to this pool. CAKEs to distribute per block.
        uint256 lastRewardTime; // Last block number that CAKEs distribution occurs.
        uint256 totalSupply; // token total supply.
        uint256 workingSupply; // boosted token supply.
        uint256 accRewardPerShare; // Accumulated reward per share.
    }

    CakeToken public cake;
    VotingEscrow public votingEscrow;
    // reward tokens created per second.
    uint256 public rewardPerSecond;
    // user_boost_share = min(
    //   user_stake_amount,
    //   k% * user_stake_amount + (1 - k%) * total_stake_amount * (user_locked_share / total_locked_share)
    // )
    uint256 public k;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;
    // The time when reward mining starts.
    uint256 public startTime;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event UpdateWorkingSupply(
        address indexed user,
        uint256 indexed pid,
        uint256 workingSupply
    );

    function initialize(
        address _cake, // reward token
        uint256 _rewardPerSecond,
        uint256 _startTime,
        address _token // first pool
    ) public onlyInitializeOnce {
        _addWhitelistAdmin(msg.sender);

        cake = CakeToken(_cake);
        rewardPerSecond = _rewardPerSecond;
        startTime = _startTime;

        // first farming pool
        poolInfo.push(
            PoolInfo({
                token: IERC20(_token),
                allocPoint: 1000,
                lastRewardTime: startTime,
                totalSupply: 0,
                workingSupply: 0,
                accRewardPerShare: 0
            })
        );

        totalAllocPoint = 1000;
        k = 40;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function getPoolInfo(uint256 offset)
        external
        view
        returns (PoolInfo[] memory result)
    {
        uint256 n =
            offset + 100 < poolInfo.length ? offset + 100 : poolInfo.length;
        if (n > offset) {
            result = new PoolInfo[](n - offset);
            for (uint256 i = offset; i < n; ++i) {
                result[i - offset] = poolInfo[i];
            }
        }
    }

    // Add a new lp to the pool. Can only be called by the whitelist admin.
    function add(
        uint256 _allocPoint,
        IERC20 _token,
        bool _withUpdate
    ) public onlyWhitelistAdmin {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardTime =
            block.timestamp > startTime ? block.timestamp : startTime;
        totalAllocPoint = totalAllocPoint + _allocPoint;
        poolInfo.push(
            PoolInfo({
                token: _token,
                allocPoint: _allocPoint,
                lastRewardTime: lastRewardTime,
                totalSupply: 0,
                workingSupply: 0,
                accRewardPerShare: 0
            })
        );
    }

    // Update the given pool's reward allocation point. Can only be called by the owner.
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) public onlyWhitelistAdmin {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 prevAllocPoint = poolInfo[_pid].allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
        if (prevAllocPoint != _allocPoint) {
            totalAllocPoint = totalAllocPoint - prevAllocPoint + _allocPoint;
        }
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    function updatePool(uint256 _pid) public {
        _updatePool(_pid);
    }

    // Update reward variables of the given pool to be up-to-date.
    function _updatePool(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.timestamp <= pool.lastRewardTime) {
            return;
        }
        if (pool.totalSupply == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }
        uint256 reward =
            ((block.timestamp - pool.lastRewardTime) *
                rewardPerSecond *
                pool.allocPoint) / totalAllocPoint;
        pool.accRewardPerShare =
            pool.accRewardPerShare +
            (reward * (10**pool.token.decimals())) /
            pool.workingSupply;
        pool.lastRewardTime = block.timestamp;
    }

    function _updateUser(uint256 _pid, address _user)
        internal
        returns (uint256 reward)
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        if (user.workingSupply > 0) {
            reward =
                (user.workingSupply *
                    (pool.accRewardPerShare - user.rewardPerShare)) /
                (10**pool.token.decimals());
            if (reward > 0) {
                cake.mint(_user, reward);
            }
            user.rewardPerShare = pool.accRewardPerShare;
        }
    }

    function _checkpoint(uint256 _pid, address _user) internal {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 l = (k * user.amount) / 100;
        uint256 votingTotal = votingEscrow.totalSupply();
        if (votingTotal > 0)
            l +=
                (((pool.totalSupply * votingEscrow.balanceOf(_user)) /
                    votingTotal) * (100 - k)) /
                100;
        if (l > user.amount) l = user.amount;
        pool.workingSupply = pool.workingSupply + l - user.workingSupply;
        user.workingSupply = l;
        emit UpdateWorkingSupply(_user, _pid, l);
    }

    // Deposit tokens to Controller for reward allocation.
    function deposit(uint256 _pid, uint256 _amount)
        public
        returns (uint256 reward)
    {
        _updatePool(_pid);
        reward = _updateUser(_pid, msg.sender);
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        if (_amount > 0) {
            pool.token.safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
            user.amount += _amount;
            pool.totalSupply += _amount;
        }
        _checkpoint(_pid, msg.sender);
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw tokens from Controller.
    function withdraw(uint256 _pid, uint256 _amount)
        public
        returns (uint256 reward)
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "FarmController: bad withdraw amount");

        _updatePool(_pid);
        reward = _updateUser(_pid, msg.sender);
        if (_amount > 0) {
            user.amount -= _amount;
            pool.totalSupply -= _amount;
            pool.token.safeTransfer(address(msg.sender), _amount);
        }
        _checkpoint(_pid, msg.sender);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // kick someone from boosting if his/her locked share expired
    function kick(uint256 _pid, address _user) public {
        require(
            votingEscrow.balanceOf(_user) == 0,
            "FramController: user locked balance is not zero"
        );
        UserInfo storage user = userInfo[_pid][_user];
        uint256 oldWorkingSupply = user.workingSupply;
        _updatePool(_pid);
        _updateUser(_pid, _user);
        _checkpoint(_pid, _user);
        require(
            oldWorkingSupply > user.workingSupply,
            "FarmController: user working supply is up-to-date"
        );
    }
}
