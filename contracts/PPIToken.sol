// SPDX-License-Identifier: MIT
pragma solidity 0.8.2;

import "./erc20/ERC20.sol";
import "./roles/Ownable.sol";

// PPIToken with Governance.
contract PPIToken is ERC20("SwappiSwap Token", "PPI", 18), Ownable {
    ///  Creates `_amount` token to `_to`. Must only be called by the owner (FarmController).
    function mint(address _to, uint256 _amount) public onlyOwner {
        _mint(_to, _amount);
    }

    function burn(uint256 _amount) public {
        _burn(msg.sender, _amount);
    }
}
