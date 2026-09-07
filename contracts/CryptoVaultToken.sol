// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CryptoVaultToken
 * @notice A plain, audited-dependency ERC-20 deployed by the CryptoVault
 *         Token Deployer. Nothing clever: OpenZeppelin ERC20 + Burnable +
 *         Permit (EIP-2612 gasless approvals) + Ownable.
 *
 * @dev Design decisions worth knowing before you deploy this:
 *      - `decimals` is configurable at construction (<= 18) instead of the
 *        hardcoded 18, because a lot of real-world tokens are not 18.
 *      - The full initial supply is minted to `initialOwner_` in the
 *        constructor.
 *      - The owner can mint more UNLESS `finishMinting()` has been called,
 *        which permanently caps the supply. Call it if you want holders to be
 *        able to trust the supply figure.
 *      - There is no pause, no blocklist, no transfer tax and no upgrade proxy.
 *        Those are the features that make a token look like a honeypot.
 */
contract CryptoVaultToken is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint8 private immutable _decimals;

    /// @notice Once true, `mint` reverts forever and total supply can only fall.
    bool public mintingFinished;

    event MintingFinished();

    error DecimalsTooLarge(uint8 provided);
    error MintingAlreadyFinished();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupplyWholeTokens_,
        address initialOwner_
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(initialOwner_) {
        if (decimals_ > 18) revert DecimalsTooLarge(decimals_);
        _decimals = decimals_;

        if (initialSupplyWholeTokens_ > 0) {
            _mint(initialOwner_, initialSupplyWholeTokens_ * (10 ** uint256(decimals_)));
        }
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint additional supply. Disabled permanently by `finishMinting`.
    function mint(address to, uint256 amount) external onlyOwner {
        if (mintingFinished) revert MintingAlreadyFinished();
        _mint(to, amount);
    }

    /// @notice Irreversibly give up the ability to mint.
    function finishMinting() external onlyOwner {
        if (mintingFinished) revert MintingAlreadyFinished();
        mintingFinished = true;
        emit MintingFinished();
    }
}
