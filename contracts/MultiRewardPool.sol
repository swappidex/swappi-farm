// SPDX-License-Identifier: MIT
pragma solidity 0.8.2;

import "./interfaces/IERC20.sol";
import "./libraries/SafeERC20.sol";

import "./utils/NeedInitialize.sol";
import "./roles/WhitelistedRole.sol";

contract MultiRewardPool is NeedInitialize, WhitelistAdminRole {
    using SafeERC20 for IERC20;

    struct RewardInfo {
        IERC20 token; // reward token
        uint256 rate; // reward release rate
        uint256 accRewardPerShare; // accumulated reward per share
    }

    struct UserInfo {
        uint256 amount; // How many tokens the user has deposited.
        mapping(address => uint256) rewardPerShare; // Accumulated reward per share.
    }

    struct PoolInfo {
        IERC20 token; // 
        RewardInfo[] rewards; // info of reward tokens
        uint256 totalSupply; // total staked token
        uint256 lastRewardTime; // last reward update timestamp
        uint256 endTime; // end time
        address sponsor; // reward sponsor
    }

    /// @notice information of pools
    /// @return token token to stake
    PoolInfo[] public poolInfo;
    /// @notice information of users in each pool
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);

    function initialize() external onlyInitializeOnce {
        _addWhitelistAdmin(msg.sender);
    }

    /// @notice add a new multi-reward pool
    /// @param _token Token to stake
    /// @param _rewards Addresses of reward token
    /// @param _rewardAmounts Amounts of reward token
    /// @param _startTime Start timestamp of reward release
    /// @param _duration Farming duration
    function add(
        IERC20 _token,
        address[] calldata _rewards,
        uint256[] calldata _rewardAmounts,
        uint256 _startTime,
        uint256 _duration
    ) external onlyWhitelistAdmin {
        require(
            _rewards.length > 0 && _rewards.length == _rewardAmounts.length,
            "MultiRewardPool: invalid length"
        );
        if (_startTime < block.timestamp) _startTime = block.timestamp;

        poolInfo.push();

        PoolInfo storage info = poolInfo[poolInfo.length - 1];
        info.token = _token;
        info.totalSupply = 0;
        info.lastRewardTime = _startTime;
        info.endTime = _startTime + _duration;
        info.sponsor = msg.sender;

        for (uint256 i = 0; i < _rewards.length; ++i) {
            info.rewards.push(
                RewardInfo({
                    token: IERC20(_rewards[i]),
                    rate: _rewardAmounts[i] / _duration,
                    accRewardPerShare: 0
                })
            );
            IERC20(_rewards[i]).safeTransferFrom(
                address(msg.sender),
                address(this),
                _rewardAmounts[i]
            );
        }
    }

    /// @notice Number of pools
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /// @notice Information of pools
    /// @param offset start index
    /// @return result Information of at most 100 pools, starts from offset index
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

    function _updatePool(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.timestamp <= pool.lastRewardTime) {
            return;
        }
        uint256 len = pool.rewards.length;
        uint256 tokenDigits = 10**pool.token.decimals();
        for (uint256 i = 0; i < len; ++i) {
            uint256 reward =
                (block.timestamp - pool.lastRewardTime) * pool.rewards[i].rate;
            if (pool.totalSupply == 0) {
                // send reward back to sponsor
                pool.rewards[i].token.safeTransfer(pool.sponsor, reward);
            } else {
                // update accumulate reward
                pool.rewards[i].accRewardPerShare +=
                    (reward * tokenDigits) /
                    pool.totalSupply;
            }
        }
        pool.lastRewardTime = block.timestamp;
    }

    function _updateUser(uint256 _pid, address _user)
        internal
        returns (address[] memory rewards, uint256[] memory rewardAmounts)
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 len = pool.rewards.length;
        uint256 tokenDigits = 10**pool.token.decimals();
        rewards = new address[](len);
        rewardAmounts = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            address reward = address(pool.rewards[i].token);
            uint256 amount =
                (user.amount *
                    (pool.rewards[i].accRewardPerShare -
                        user.rewardPerShare[reward])) / tokenDigits;
            // send reward
            if (amount > 0) {
                IERC20(reward).safeTransfer(_user, amount);
            }
            // update user info
            user.rewardPerShare[reward] = pool.rewards[i].accRewardPerShare;

            rewards[i] = reward;
            rewardAmounts[i] = amount;
        }
    }

    /// @notice deposit token in farming pool
    /// @param _pid Index of pool
    /// @param _amount Deposit amount
    /// @return rewards Addresses of reward token
    /// @return rewardAmounts Amounts of reward token
    function deposit(uint256 _pid, uint256 _amount)
        external
        returns (address[] memory rewards, uint256[] memory rewardAmounts)
    {
        _updatePool(_pid);
        (rewards, rewardAmounts) = _updateUser(_pid, msg.sender);

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
        emit Deposit(msg.sender, _pid, _amount);
    }

    /// @notice withdraw tokens from farming pool
    /// @param _pid Index of pool
    /// @param _amount Withdraw amount
    /// @return rewards Addresses of reward token
    /// @return rewardAmounts Amounts of reward token
    function withdraw(uint256 _pid, uint256 _amount)
        external
        returns (address[] memory rewards, uint256[] memory rewardAmounts)
    {
        _updatePool(_pid);
        (rewards, rewardAmounts) = _updateUser(_pid, msg.sender);

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "MultiRewardPool: bad withdraw amount");

        if (_amount > 0) {
            user.amount -= _amount;
            pool.totalSupply -= _amount;
            pool.token.safeTransfer(address(msg.sender), _amount);
        }
        emit Withdraw(msg.sender, _pid, _amount);
    }
}
