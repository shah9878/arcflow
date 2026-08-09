// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ArcFlowPriceOracle
 * @notice Simple owner-set price feed used by ArcFlowLendingPool.
 *
 * Price convention (must match frontend / pool accounting):
 *   price is USD per 1 whole token, scaled by 1e18.
 *   ArcFlow markets:
 *     USDC   = $1     → 1e18
 *     EURC   = $1.25  → 1.25e18
 *     cirBTC = $65000 → 65000e18
 *
 * After deploy (owner):
 *   1. setPrice / setPrices for every market token
 *   2. Deploy ArcFlowLendingPool(address(this oracle))
 *   3. Paste oracle address into frontend `src/lib/contracts.ts`
 */
contract ArcFlowPriceOracle {
    address public owner;
    mapping(address => uint256) public prices;

    event PriceUpdated(address indexed token, uint256 price);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "ArcFlowPriceOracle: ONLY_OWNER");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ArcFlowPriceOracle: INVALID_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Set one token price (1e18 = $1.00 per whole token unit)
    function setPrice(address token, uint256 price) external onlyOwner {
        require(token != address(0), "ArcFlowPriceOracle: INVALID_TOKEN");
        require(price > 0, "ArcFlowPriceOracle: INVALID_PRICE");
        prices[token] = price;
        emit PriceUpdated(token, price);
    }

    /// @notice Batch set prices (same length arrays)
    function setPrices(address[] calldata tokens, uint256[] calldata priceValues) external onlyOwner {
        require(tokens.length == priceValues.length, "ArcFlowPriceOracle: LENGTH_MISMATCH");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "ArcFlowPriceOracle: INVALID_TOKEN");
            require(priceValues[i] > 0, "ArcFlowPriceOracle: INVALID_PRICE");
            prices[tokens[i]] = priceValues[i];
            emit PriceUpdated(tokens[i], priceValues[i]);
        }
    }

    /// @notice USD price with 18 decimals. Reverts if unset.
    function getPrice(address token) external view returns (uint256) {
        uint256 price = prices[token];
        require(price > 0, "ArcFlowPriceOracle: PRICE_NOT_SET");
        return price;
    }

    /// @notice Non-reverting read for UIs (0 = not set)
    function tryGetPrice(address token) external view returns (uint256) {
        return prices[token];
    }
}
