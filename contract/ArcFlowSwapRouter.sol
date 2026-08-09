// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract ArcFlowSwapRouter is ReentrancyGuard {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
    }

    // Pool key -> Pool details
    mapping(bytes32 => Pool) public pools;
    // Pool key -> User address -> LP balance
    mapping(bytes32 => mapping(address => uint256)) public lpBalances;

    event LiquidityAdded(
        address indexed provider,
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );

    event LiquidityRemoved(
        address indexed provider,
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );

    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "ArcFlowSwapRouter: EXPIRED");
        _;
    }

    function getPoolKey(address tokenA, address tokenB) public pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
        require(amountA > 0, "ArcFlowSwapRouter: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "ArcFlowSwapRouter: INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        require(amountIn > 0, "ArcFlowSwapRouter: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "ArcFlowSwapRouter: INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        bytes32 key = getPoolKey(tokenA, tokenB);
        Pool storage pool = pools[key];

        if (pool.token0 == address(0)) {
            (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
            pool.token0 = t0;
            pool.token1 = t1;
        }

        uint256 reserveA = tokenA == pool.token0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveB = tokenA == pool.token0 ? pool.reserve1 : pool.reserve0;

        if (reserveA == 0 && reserveB == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
            liquidity = Math.sqrt(amountA * amountB);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "ArcFlowSwapRouter: INSUFFICIENT_B_AMOUNT");
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal <= amountADesired, "ArcFlowSwapRouter: OPTIMAL_A_TOO_HIGH");
                require(amountAOptimal >= amountAMin, "ArcFlowSwapRouter: INSUFFICIENT_A_AMOUNT");
                amountA = amountAOptimal;
                amountB = amountBDesired;
            }
            uint256 liquidityA = (amountA * pool.totalLiquidity) / reserveA;
            uint256 liquidityB = (amountB * pool.totalLiquidity) / reserveB;
            liquidity = liquidityA < liquidityB ? liquidityA : liquidityB;
        }

        require(liquidity > 0, "ArcFlowSwapRouter: INSUFFICIENT_LIQUIDITY_MINTED");

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        if (tokenA == pool.token0) {
            pool.reserve0 += amountA;
            pool.reserve1 += amountB;
        } else {
            pool.reserve0 += amountB;
            pool.reserve1 += amountA;
        }

        pool.totalLiquidity += liquidity;
        lpBalances[key][to] += liquidity;

        emit LiquidityAdded(msg.sender, tokenA, tokenB, amountA, amountB, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB) {
        bytes32 key = getPoolKey(tokenA, tokenB);
        Pool storage pool = pools[key];
        require(pool.token0 != address(0), "ArcFlowSwapRouter: POOL_NOT_FOUND");
        require(lpBalances[key][msg.sender] >= liquidity, "ArcFlowSwapRouter: INSUFFICIENT_LP_BALANCE");

        uint256 reserve0 = pool.reserve0;
        uint256 reserve1 = pool.reserve1;
        uint256 totalLp = pool.totalLiquidity;

        uint256 amount0 = (liquidity * reserve0) / totalLp;
        uint256 amount1 = (liquidity * reserve1) / totalLp;

        require(amount0 > 0 && amount1 > 0, "ArcFlowSwapRouter: INSUFFICIENT_LIQUIDITY_BURNED");

        (address t0, ) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (tokenA == t0) {
            amountA = amount0;
            amountB = amount1;
        } else {
            amountA = amount1;
            amountB = amount0;
        }

        require(amountA >= amountAMin, "ArcFlowSwapRouter: INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "ArcFlowSwapRouter: INSUFFICIENT_B_AMOUNT");

        lpBalances[key][msg.sender] -= liquidity;
        pool.totalLiquidity -= liquidity;
        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;

        IERC20(pool.token0).transfer(to, amount0);
        IERC20(pool.token1).transfer(to, amount1);

        emit LiquidityRemoved(msg.sender, tokenA, tokenB, amountA, amountB, liquidity);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2, "ArcFlowSwapRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            (address tokenIn, address tokenOut) = (path[i], path[i + 1]);
            bytes32 key = getPoolKey(tokenIn, tokenOut);
            Pool storage pool = pools[key];
            require(pool.token0 != address(0), "ArcFlowSwapRouter: POOL_NOT_FOUND");

            uint256 reserveIn = tokenIn == pool.token0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = tokenIn == pool.token0 ? pool.reserve1 : pool.reserve0;

            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }

        require(amounts[amounts.length - 1] >= amountOutMin, "ArcFlowSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        for (uint256 i = 0; i < path.length - 1; i++) {
            (address tokenIn, address tokenOut) = (path[i], path[i + 1]);
            bytes32 key = getPoolKey(tokenIn, tokenOut);
            Pool storage pool = pools[key];

            uint256 amountInStep = amounts[i];
            uint256 amountOutStep = amounts[i + 1];

            if (tokenIn == pool.token0) {
                pool.reserve0 += amountInStep;
                pool.reserve1 -= amountOutStep;
            } else {
                pool.reserve0 -= amountOutStep;
                pool.reserve1 += amountInStep;
            }

            address recipient = (i == path.length - 2) ? to : address(this);
            IERC20(tokenOut).transfer(recipient, amountOutStep);

            emit Swap(msg.sender, tokenIn, tokenOut, amountInStep, amountOutStep, recipient);
        }
    }
}
