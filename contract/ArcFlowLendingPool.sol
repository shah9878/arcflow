// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IArcFlowPriceOracle {
    function getPrice(address token) external view returns (uint256);
}

/**
 * @title ArcFlowLendingPool
 * @notice Supply / borrow pool for Arc testnet tokens (USDC, EURC, cirBTC).
 *
 * Frontend ABI surface (keep stable):
 *   - assets(token) → (isSupported, totalSupplied, totalBorrowed, lastUpdateTime, baseRate, rateMultiplier)
 *   - getSupplyRate(token) / getBorrowRate(token)  // 18-dec APR fraction (0.02e18 = 2%)
 *   - supplyShares / borrowShares / supplySharesToAmount / borrowSharesToAmount
 *   - getUserAccountData(user)
 *   - supply / withdraw / borrow / repay
 *
 * Rates:
 *   baseRate + utilization * rateMultiplier  (both 18-dec fractions)
 *   supplyRate = utilization * borrowRate
 *   Frontend: apr% = formatUnits(rate, 18) * 100
 *
 * Arc USDC note:
 *   Use ERC-20 interface at 0x3600…0000 with 6 decimals for approve / transferFrom.
 *   Native gas balance shares the same funds (18-dec view) — do not mix units.
 *
 * Deploy order (owner):
 *   1. Deploy ArcFlowPriceOracle → setPrices for markets
 *   2. Deploy ArcFlowLendingPool(oracle)
 *   3. addSupportedAsset / addSupportedAssets for each market token
 *   4. Paste pool + oracle addresses into frontend `src/lib/contracts.ts`
 */
contract ArcFlowLendingPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct AssetInfo {
        bool isSupported;
        uint256 totalSupplied;
        uint256 totalBorrowed;
        uint256 lastUpdateTime;
        uint256 baseRate; // 18-dec APR fraction, e.g. 2% = 0.02e18
        uint256 rateMultiplier; // 18-dec, e.g. 10% = 0.1e18
    }

    address public owner;
    IArcFlowPriceOracle public oracle;

    /// @notice Liquidation threshold: 80% (0.8e18)
    uint256 public constant LIQUIDATION_THRESHOLD = 80 * 10 ** 16;

    mapping(address => AssetInfo) public assets;
    address[] public supportedAssets;

    mapping(address => mapping(address => uint256)) public supplyShares;
    mapping(address => mapping(address => uint256)) public borrowShares;

    mapping(address => uint256) public totalSupplyShares;
    mapping(address => uint256) public totalBorrowShares;

    event Supply(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Borrow(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Repay(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Liquidate(
        address indexed borrower,
        address indexed collateralAsset,
        address indexed debtAsset,
        uint256 debtToCover,
        uint256 collateralSeized,
        address liquidator
    );
    event AssetSupported(address indexed token, uint256 baseRate, uint256 rateMultiplier);
    event AssetRatesUpdated(address indexed token, uint256 baseRate, uint256 rateMultiplier);
    event OracleUpdated(address indexed oracle);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "ArcFlowLendingPool: ONLY_OWNER");
        _;
    }

    constructor(address _oracle) {
        require(_oracle != address(0), "ArcFlowLendingPool: INVALID_ORACLE");
        owner = msg.sender;
        oracle = IArcFlowPriceOracle(_oracle);
        emit OwnershipTransferred(address(0), msg.sender);
        emit OracleUpdated(_oracle);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ArcFlowLendingPool: INVALID_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getSupportedAssets() external view returns (address[] memory) {
        return supportedAssets;
    }

    function addSupportedAsset(address token, uint256 baseRate, uint256 rateMultiplier) external onlyOwner {
        _addSupportedAsset(token, baseRate, rateMultiplier);
    }

    /// @notice Batch-list markets (same-length arrays). Call after oracle prices are set.
    function addSupportedAssets(
        address[] calldata tokens,
        uint256[] calldata baseRates,
        uint256[] calldata rateMultipliers
    ) external onlyOwner {
        require(
            tokens.length == baseRates.length && tokens.length == rateMultipliers.length,
            "ArcFlowLendingPool: LENGTH_MISMATCH"
        );
        for (uint256 i = 0; i < tokens.length; i++) {
            _addSupportedAsset(tokens[i], baseRates[i], rateMultipliers[i]);
        }
    }

    function _addSupportedAsset(address token, uint256 baseRate, uint256 rateMultiplier) internal {
        require(token != address(0), "ArcFlowLendingPool: INVALID_TOKEN");
        require(!assets[token].isSupported, "ArcFlowLendingPool: ALREADY_SUPPORTED");
        // Touch metadata to fail early if token is not ERC-20-like (decimals)
        IERC20Metadata(token).decimals();

        assets[token] = AssetInfo({
            isSupported: true,
            totalSupplied: 0,
            totalBorrowed: 0,
            lastUpdateTime: block.timestamp,
            baseRate: baseRate,
            rateMultiplier: rateMultiplier
        });
        supportedAssets.push(token);
        emit AssetSupported(token, baseRate, rateMultiplier);
    }

    function setAssetRates(address token, uint256 baseRate, uint256 rateMultiplier) external onlyOwner {
        require(assets[token].isSupported, "ArcFlowLendingPool: UNSUPPORTED_TOKEN");
        accrueInterest(token);
        assets[token].baseRate = baseRate;
        assets[token].rateMultiplier = rateMultiplier;
        emit AssetRatesUpdated(token, baseRate, rateMultiplier);
    }

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "ArcFlowLendingPool: INVALID_ORACLE");
        oracle = IArcFlowPriceOracle(_oracle);
        emit OracleUpdated(_oracle);
    }

    /// @notice Borrow APR as 18-dec fraction (e.g. 0.05e18 = 5%)
    function getBorrowRate(address token) public view returns (uint256) {
        AssetInfo memory asset = assets[token];
        if (!asset.isSupported) return 0;
        if (asset.totalSupplied == 0) return asset.baseRate;
        uint256 utilization = (asset.totalBorrowed * 1e18) / asset.totalSupplied;
        return asset.baseRate + (utilization * asset.rateMultiplier) / 1e18;
    }

    /// @notice Supply APR as 18-dec fraction. 0 when no utilization.
    function getSupplyRate(address token) public view returns (uint256) {
        AssetInfo memory asset = assets[token];
        if (!asset.isSupported || asset.totalSupplied == 0) return 0;
        uint256 utilization = (asset.totalBorrowed * 1e18) / asset.totalSupplied;
        uint256 borrowRate = getBorrowRate(token);
        return (utilization * borrowRate) / 1e18;
    }

    function accrueInterest(address token) public {
        AssetInfo storage asset = assets[token];
        if (!asset.isSupported) return;
        if (asset.lastUpdateTime == 0 || block.timestamp <= asset.lastUpdateTime) {
            asset.lastUpdateTime = block.timestamp;
            return;
        }
        uint256 timeElapsed = block.timestamp - asset.lastUpdateTime;
        asset.lastUpdateTime = block.timestamp;

        if (asset.totalSupplied == 0 || asset.totalBorrowed == 0) return;

        uint256 borrowRate = getBorrowRate(token);
        uint256 interestAccrued = (asset.totalBorrowed * borrowRate * timeElapsed) / (365 days * 1e18);

        if (interestAccrued > 0) {
            asset.totalBorrowed += interestAccrued;
            asset.totalSupplied += interestAccrued;
        }
    }

    function supplySharesToAmount(address token, uint256 shares) public view returns (uint256) {
        uint256 totalShares = totalSupplyShares[token];
        if (totalShares == 0) return shares;
        return (shares * assets[token].totalSupplied) / totalShares;
    }

    function amountToSupplyShares(address token, uint256 amount) public view returns (uint256) {
        uint256 totalShares = totalSupplyShares[token];
        if (totalShares == 0 || assets[token].totalSupplied == 0) return amount;
        return (amount * totalShares) / assets[token].totalSupplied;
    }

    function borrowSharesToAmount(address token, uint256 shares) public view returns (uint256) {
        uint256 totalShares = totalBorrowShares[token];
        if (totalShares == 0) return shares;
        return (shares * assets[token].totalBorrowed) / totalShares;
    }

    function amountToBorrowShares(address token, uint256 amount) public view returns (uint256) {
        uint256 totalShares = totalBorrowShares[token];
        if (totalShares == 0 || assets[token].totalBorrowed == 0) return amount;
        return (amount * totalShares) / assets[token].totalBorrowed;
    }

    function getUserAccountData(address user)
        public
        view
        returns (uint256 totalCollateralValueUSD, uint256 totalBorrowValueUSD, uint256 healthFactor)
    {
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            address token = supportedAssets[i];
            uint8 decimals = IERC20Metadata(token).decimals();

            uint256 supplyShare = supplyShares[user][token];
            if (supplyShare > 0) {
                uint256 supplyAmount = supplySharesToAmount(token, supplyShare);
                uint256 price = oracle.getPrice(token);
                totalCollateralValueUSD += (supplyAmount * price) / (10 ** decimals);
            }

            uint256 borrowShare = borrowShares[user][token];
            if (borrowShare > 0) {
                uint256 borrowAmount = borrowSharesToAmount(token, borrowShare);
                uint256 price = oracle.getPrice(token);
                totalBorrowValueUSD += (borrowAmount * price) / (10 ** decimals);
            }
        }

        if (totalBorrowValueUSD == 0) {
            healthFactor = type(uint256).max;
        } else {
            healthFactor = (totalCollateralValueUSD * LIQUIDATION_THRESHOLD) / totalBorrowValueUSD;
        }
    }

    function supply(address token, uint256 amount) external nonReentrant {
        require(assets[token].isSupported, "ArcFlowLendingPool: UNSUPPORTED_TOKEN");
        require(amount > 0, "ArcFlowLendingPool: INVALID_AMOUNT");

        accrueInterest(token);

        // Pull tokens first so a failed USDC transfer cannot leave phantom shares
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 shares = amountToSupplyShares(token, amount);
        require(shares > 0, "ArcFlowLendingPool: ZERO_SHARES");

        supplyShares[msg.sender][token] += shares;
        totalSupplyShares[token] += shares;
        assets[token].totalSupplied += amount;

        emit Supply(msg.sender, token, amount, shares);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(assets[token].isSupported, "ArcFlowLendingPool: UNSUPPORTED_TOKEN");
        require(amount > 0, "ArcFlowLendingPool: INVALID_AMOUNT");

        accrueInterest(token);

        uint256 userSupplyAmount = supplySharesToAmount(token, supplyShares[msg.sender][token]);
        require(userSupplyAmount >= amount, "ArcFlowLendingPool: INSUFFICIENT_SUPPLY_BALANCE");

        uint256 sharesToBurn = amountToSupplyShares(token, amount);
        if (sharesToBurn > supplyShares[msg.sender][token]) {
            sharesToBurn = supplyShares[msg.sender][token];
        }

        supplyShares[msg.sender][token] -= sharesToBurn;
        totalSupplyShares[token] -= sharesToBurn;
        assets[token].totalSupplied -= amount;

        (, , uint256 healthFactor) = getUserAccountData(msg.sender);
        require(healthFactor >= 1e18, "ArcFlowLendingPool: HEALTH_FACTOR_BELOW_THRESHOLD");

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, token, amount, sharesToBurn);
    }

    function borrow(address token, uint256 amount) external nonReentrant {
        require(assets[token].isSupported, "ArcFlowLendingPool: UNSUPPORTED_TOKEN");
        require(amount > 0, "ArcFlowLendingPool: INVALID_AMOUNT");

        accrueInterest(token);

        uint256 poolLiquidity = IERC20(token).balanceOf(address(this));
        // Available liquidity excludes funds already counted as borrowed (simple model)
        require(poolLiquidity >= amount, "ArcFlowLendingPool: INSUFFICIENT_POOL_LIQUIDITY");

        uint256 shares = amountToBorrowShares(token, amount);
        require(shares > 0, "ArcFlowLendingPool: ZERO_SHARES");

        borrowShares[msg.sender][token] += shares;
        totalBorrowShares[token] += shares;
        assets[token].totalBorrowed += amount;

        (, , uint256 healthFactor) = getUserAccountData(msg.sender);
        require(healthFactor >= 1e18, "ArcFlowLendingPool: HEALTH_FACTOR_BELOW_THRESHOLD");

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Borrow(msg.sender, token, amount, shares);
    }

    function repay(address token, uint256 amount) external nonReentrant {
        require(assets[token].isSupported, "ArcFlowLendingPool: UNSUPPORTED_TOKEN");
        require(amount > 0, "ArcFlowLendingPool: INVALID_AMOUNT");

        accrueInterest(token);

        uint256 userDebt = borrowSharesToAmount(token, borrowShares[msg.sender][token]);
        require(userDebt > 0, "ArcFlowLendingPool: NO_DEBT");
        uint256 repayAmount = amount > userDebt ? userDebt : amount;

        // Pull first
        IERC20(token).safeTransferFrom(msg.sender, address(this), repayAmount);

        uint256 sharesToBurn = amountToBorrowShares(token, repayAmount);
        if (sharesToBurn > borrowShares[msg.sender][token]) {
            sharesToBurn = borrowShares[msg.sender][token];
        }

        borrowShares[msg.sender][token] -= sharesToBurn;
        totalBorrowShares[token] -= sharesToBurn;
        assets[token].totalBorrowed -= repayAmount;

        emit Repay(msg.sender, token, repayAmount, sharesToBurn);
    }

    function liquidate(address borrower, address collateralAsset, address debtAsset, uint256 debtToCover)
        external
        nonReentrant
    {
        require(assets[collateralAsset].isSupported, "ArcFlowLendingPool: UNSUPPORTED_COLLATERAL_TOKEN");
        require(assets[debtAsset].isSupported, "ArcFlowLendingPool: UNSUPPORTED_DEBT_TOKEN");
        require(borrower != msg.sender, "ArcFlowLendingPool: CANNOT_LIQUIDATE_SELF");

        accrueInterest(collateralAsset);
        accrueInterest(debtAsset);

        (, , uint256 healthFactor) = getUserAccountData(borrower);
        require(healthFactor < 1e18, "ArcFlowLendingPool: POSITION_IS_HEALTHY");

        uint256 userDebt = borrowSharesToAmount(debtAsset, borrowShares[borrower][debtAsset]);
        require(userDebt > 0, "ArcFlowLendingPool: NO_DEBT_TO_COVER");

        uint256 actualDebtToCover = debtToCover > userDebt ? userDebt : debtToCover;

        uint256 debtPrice = oracle.getPrice(debtAsset);
        uint256 collateralPrice = oracle.getPrice(collateralAsset);
        uint8 debtDecimals = IERC20Metadata(debtAsset).decimals();
        uint8 collDecimals = IERC20Metadata(collateralAsset).decimals();

        uint256 debtValueUSD = (actualDebtToCover * debtPrice) / (10 ** debtDecimals);
        uint256 collateralToSeizeValueUSD = (debtValueUSD * 110) / 100; // 10% bonus

        uint256 collateralToSeize = (collateralToSeizeValueUSD * (10 ** collDecimals)) / collateralPrice;

        uint256 userCollateral = supplySharesToAmount(collateralAsset, supplyShares[borrower][collateralAsset]);
        if (collateralToSeize > userCollateral) {
            collateralToSeize = userCollateral;
            uint256 seizeValueUSD = (collateralToSeize * collateralPrice) / (10 ** collDecimals);
            actualDebtToCover = (seizeValueUSD * 100 * (10 ** debtDecimals)) / (debtPrice * 110);
        }

        require(actualDebtToCover > 0 && collateralToSeize > 0, "ArcFlowLendingPool: LIQUIDATION_TOO_SMALL");

        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), actualDebtToCover);

        uint256 debtSharesToBurn = amountToBorrowShares(debtAsset, actualDebtToCover);
        if (debtSharesToBurn > borrowShares[borrower][debtAsset]) {
            debtSharesToBurn = borrowShares[borrower][debtAsset];
        }
        borrowShares[borrower][debtAsset] -= debtSharesToBurn;
        totalBorrowShares[debtAsset] -= debtSharesToBurn;
        assets[debtAsset].totalBorrowed -= actualDebtToCover;

        uint256 collateralSharesToBurn = amountToSupplyShares(collateralAsset, collateralToSeize);
        if (collateralSharesToBurn > supplyShares[borrower][collateralAsset]) {
            collateralSharesToBurn = supplyShares[borrower][collateralAsset];
        }
        supplyShares[borrower][collateralAsset] -= collateralSharesToBurn;
        totalSupplyShares[collateralAsset] -= collateralSharesToBurn;
        assets[collateralAsset].totalSupplied -= collateralToSeize;

        IERC20(collateralAsset).safeTransfer(msg.sender, collateralToSeize);

        emit Liquidate(borrower, collateralAsset, debtAsset, actualDebtToCover, collateralToSeize, msg.sender);
    }
}
