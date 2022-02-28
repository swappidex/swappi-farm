// SPDX-License-Identifier: MIT
pragma solidity 0.8.2;

import "./interfaces/IERC20.sol";
import "./libraries/SafeERC20.sol";

import "./utils/ReentrancyGuard.sol";
import "./utils/NeedInitialize.sol";
import "./roles/WhitelistedRole.sol";

contract VotingEscrow is ReentrancyGuard, WhitelistedRole, NeedInitialize {
    using SafeERC20 for IERC20;

    struct LockedBalance {
        uint256 amount;
        uint256 unlockTime;
    }

    string public name;
    string public symbol;
    uint8 public decimals;

    uint256 lastCheckpoint;
    uint256 totalLocked;
    uint256 nextWeekSupply;

    IERC20 token;

    uint256 public maxTime; // 4 years

    mapping(address => LockedBalance) public userInfo;
    mapping(uint256 => uint256) public historySupply;
    mapping(uint256 => uint256) public unlockSchedule;

    event LockCreated(
        address indexed account,
        uint256 amount,
        uint256 unlockTime
    );

    event AmountIncreased(address indexed account, uint256 increasedAmount);

    event UnlockTimeIncreased(address indexed account, uint256 newUnlockTime);

    event Withdrawn(address indexed account, uint256 amount);

    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _token
    ) external onlyInitializeOnce {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        token = IERC20(token);

        lastCheckpoint = _adjustedTime(block.timestamp);

        maxTime = 4 * 365 * 86400;

        token = IERC20(_token);

        _addWhitelistAdmin(msg.sender);
    }

    // return start timestamp of lastest week
    function _adjustedTime(uint256 x) internal pure returns (uint256) {
        return (x / 1 weeks) * 1 weeks;
    }

    function createLock(uint256 _amount, uint256 _unlockTime)
        public
        nonReentrant
    {
        require(
            msg.sender == tx.origin || isWhitelisted(msg.sender),
            "VotingEscrow: sender is contract not in whitelist"
        );
        require(_amount > 0, "VotingEscrow: amount is zero");

        _unlockTime = _adjustedTime(_unlockTime);
        LockedBalance storage user = userInfo[msg.sender];

        require(user.amount == 0, "VotingEscrow: withdraw old tokens first");
        require(
            _unlockTime > block.timestamp,
            "VotingEscrow: unlock time < current timestamp"
        );
        require(
            _unlockTime <= block.timestamp + maxTime,
            "VotingEscrow: exceed maxlock time"
        );

        _checkpoint(_amount, _unlockTime, user.amount, user.unlockTime);

        unlockSchedule[_unlockTime] += _amount;
        user.unlockTime = _unlockTime;
        user.amount = _amount;

        token.safeTransferFrom(msg.sender, address(this), _amount);

        emit LockCreated(msg.sender, _amount, _unlockTime);
    }

    function increaseAmount(address _account, uint256 _amount)
        external
        nonReentrant
    {
        LockedBalance storage user = userInfo[_account];

        require(_amount > 0, "VotingEscrow: amount is zero");
        require(user.amount > 0, "VotingEscrow: No existing lock found");
        require(
            user.unlockTime > block.timestamp,
            "VotingEscrow: Cannot add to expired lock"
        );

        uint256 newAmount = user.amount + _amount;
        _checkpoint(newAmount, user.unlockTime, user.amount, user.unlockTime);
        unlockSchedule[user.unlockTime] =
            unlockSchedule[user.unlockTime] +
            _amount;
        user.amount = newAmount;

        token.safeTransferFrom(msg.sender, address(this), _amount);

        emit AmountIncreased(_account, _amount);
    }

    function increaseUnlockTime(uint256 _unlockTime) external nonReentrant {
        _unlockTime = _adjustedTime(_unlockTime);
        LockedBalance storage user = userInfo[msg.sender];

        require(user.amount > 0, "VotingEscrow: No existing lock found");
        require(
            user.unlockTime > block.timestamp,
            "VotingEscrow: Lock expired"
        );
        require(
            _unlockTime > user.unlockTime,
            "VotingEscrow: Can only increase lock duration"
        );
        require(
            _unlockTime <= block.timestamp + maxTime,
            "VotingEscrow: Voting lock cannot exceed max lock time"
        );

        _checkpoint(user.amount, _unlockTime, user.amount, user.unlockTime);
        unlockSchedule[user.unlockTime] =
            unlockSchedule[user.unlockTime] -
            user.amount;
        unlockSchedule[_unlockTime] = unlockSchedule[_unlockTime] + user.amount;
        user.unlockTime = _unlockTime;

        emit UnlockTimeIncreased(msg.sender, _unlockTime);
    }

    function withdraw() external nonReentrant {
        LockedBalance memory user = userInfo[msg.sender];
        require(
            block.timestamp >= user.unlockTime,
            "VotingEscrow: The lock is not expired"
        );

        uint256 amount = user.amount;
        user.unlockTime = 0;
        user.amount = 0;
        userInfo[msg.sender] = user;

        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function totalSupply() external view returns (uint256 result) {
        uint256 w = lastCheckpoint;
        uint256 currentWeek = _adjustedTime(block.timestamp);
        uint256 newTotalLocked = totalLocked;
        uint256 newNextWeekSupply = nextWeekSupply;
        if (w < currentWeek) {
            w += 1 weeks;
            for (; w < currentWeek; w += 1 weeks) {
                newTotalLocked = newTotalLocked - unlockSchedule[w];
                newNextWeekSupply =
                    newNextWeekSupply -
                    (newTotalLocked * 1 weeks) /
                    maxTime;
            }
            newTotalLocked = newTotalLocked - unlockSchedule[currentWeek];
            result =
                newNextWeekSupply -
                (newTotalLocked * (block.timestamp - currentWeek)) /
                maxTime;
        } else {
            result =
                newNextWeekSupply +
                (newTotalLocked * (currentWeek + 1 weeks - block.timestamp)) /
                maxTime;
        }
    }

    function totalSupplyAtTimestamp(uint256 _timestamp)
        external
        view
        returns (uint256)
    {
        return _totalSupplyAtTimestamp(_timestamp);
    }

    function _totalSupplyAtTimestamp(uint256 _timestamp)
        internal
        view
        returns (uint256)
    {
        uint256 w = _adjustedTime(_timestamp) + 1 weeks;
        uint256 total = 0;
        for (; w <= _timestamp + maxTime; w += 1 weeks) {
            total = total + (unlockSchedule[w] * (w - _timestamp)) / maxTime;
        }
        return total;
    }

    function balanceOf(address _account) external view returns (uint256) {
        return _balanceOfAtTimestamp(_account, block.timestamp);
    }

    function balanceOfAtTimestamp(address _account, uint256 _timestamp)
        external
        view
        returns (uint256)
    {
        return _balanceOfAtTimestamp(_account, _timestamp);
    }

    function _balanceOfAtTimestamp(address _account, uint256 _timestamp)
        private
        view
        returns (uint256)
    {
        require(
            _timestamp >= block.timestamp,
            "VotingEscrow: Must be current or future time"
        );
        LockedBalance memory user = userInfo[_account];
        if (_timestamp > user.unlockTime) {
            return 0;
        }
        return (user.amount * (user.unlockTime - _timestamp)) / maxTime;
    }

    function checkpoint() external {
        _checkpoint(0, 0, 0, 0);
    }

    function _checkpoint(
        uint256 _newAmount,
        uint256 _newUnlockTime,
        uint256 _oldAmount,
        uint256 _oldUnlockTime
    ) internal {
        // update supply to current week
        uint256 w = lastCheckpoint;
        uint256 currentWeek = _adjustedTime(block.timestamp);
        uint256 newTotalLocked = totalLocked;
        uint256 newNextWeekSupply = nextWeekSupply;
        if (w < currentWeek) {
            w += 1 weeks;
            for (; w <= currentWeek; w += 1 weeks) {
                historySupply[w] = newNextWeekSupply;
                newTotalLocked = newTotalLocked - unlockSchedule[w];
                newNextWeekSupply =
                    newNextWeekSupply -
                    (newTotalLocked * 1 weeks) /
                    maxTime;
            }
            lastCheckpoint = currentWeek;
        }

        // remove old schedule
        uint256 nextWeek = currentWeek + 1 weeks;
        if (_oldAmount > 0 && _oldUnlockTime >= nextWeek) {
            newTotalLocked = newTotalLocked - _oldAmount;
            newNextWeekSupply =
                newNextWeekSupply -
                (_oldAmount * (_oldUnlockTime - nextWeek)) /
                maxTime;
        }

        totalLocked = newTotalLocked + _newAmount;
        nextWeekSupply =
            newNextWeekSupply +
            (_newAmount * (_newUnlockTime - nextWeek) + maxTime - 1) /
            maxTime;
    }
}
