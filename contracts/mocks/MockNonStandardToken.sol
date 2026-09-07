// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * A deliberately non-standard ERC-20, modelled on USDT's mainnet behaviour.
 * Used only by scripts/test-evm-integration.ts - never shipped in the app.
 *
 *  - `transfer` and `approve` return nothing instead of bool
 *  - `approve` reverts when changing a non-zero allowance to another non-zero
 *    value, which is what breaks naive swap integrations
 */
contract MockNonStandardToken {
    string public name = "Mock Tether";
    string public symbol = "MUSDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 supply) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    // Note: no `returns (bool)` - this is the whole point of the mock.
    function transfer(address to, uint256 value) public {
        require(balanceOf[msg.sender] >= value, "insufficient");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
    }

    function approve(address spender, uint256 value) public {
        // The USDT rule that trips everyone up.
        require(value == 0 || allowance[msg.sender][spender] == 0, "unsafe approve");
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transferFrom(address from, address to, uint256 value) public {
        require(allowance[from][msg.sender] >= value, "not allowed");
        require(balanceOf[from] >= value, "insufficient");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
