// SPDX-License-Identifier: MIT
pragma solidity 0.8.2;

import "./utils/NeedInitialize.sol";

contract PPIRate is NeedInitialize {
    struct Rate {
        uint256 startTime;
        uint256 rate;
    }

    // reward in seconds
    Rate[] public timeRate;

    function initialize(Rate[] memory rates) public onlyInitializeOnce {
        require(rates.length > 0, "PPIRate: empty rate");
        require(rates[rates.length - 1].rate == 0, "PPIRate: never end");
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < rates.length; ++i) {
            require(rates[i].startTime > t, "PPIRate: invalid");
            t = rates[i].startTime;
            timeRate.push(rates[i]);
        }
    }

    function calculateReward(uint256 start, uint256 end)
        public
        view
        returns (uint256 reward)
    {
        uint256 len = timeRate.length;
        reward = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (i + 1 < len && start >= timeRate[i + 1].startTime) continue;
            uint256 l = timeRate[i].startTime;
            if (end <= l) break;
            if (l < start) l = start;
            uint256 r = end;
            if (i + 1 < len && timeRate[i + 1].startTime < r) {
                r = timeRate[i + 1].startTime;
            }
            reward = reward + timeRate[i].rate * (r - l);
        }
    }
}
