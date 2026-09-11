"""
Monte Carlo Stress Lab Engine
Vectorized bootstrap resampling and sequence-of-returns stress testing for MyTradingView.
"""

import numpy as np


def run_monte_carlo_simulation(
    initial_balance=10000.0,
    simulations=1000,
    num_trades=100,
    win_rate=60.0,
    reward_risk=1.5,
    risk_per_trade=100.0,
    lot_size=0.10,
    ruin_threshold_pct=20.0,
    trade_returns=None,
):
    """
    Run vectorized Monte Carlo simulations.
    
    Args:
        initial_balance (float): Starting balance in USD.
        simulations (int): Number of synthetic paths (100 to 3000).
        num_trades (int): Number of sequential trades in each path (20 to 500).
        win_rate (float): Win rate percentage (0 to 100).
        reward_risk (float): Payoff ratio (Reward / Risk).
        risk_per_trade (float): Dollar risk on loss.
        lot_size (float): Lot size used.
        ruin_threshold_pct (float): Drawdown % threshold defining "ruin" (e.g., 20%).
        trade_returns (list[float]|None): Optional list of historical trade PnLs to bootstrap.
    """
    simulations = max(50, min(int(simulations), 3000))
    num_trades = max(10, min(int(num_trades), 500))
    initial_balance = max(100.0, float(initial_balance))
    ruin_threshold_pct = max(5.0, min(float(ruin_threshold_pct), 90.0))
    lot_size = float(lot_size) if lot_size else 0.10

    if trade_returns is not None and len(trade_returns) >= 8:
        # Bootstrap with replacement from empirical trade history
        returns_arr = np.array(trade_returns, dtype=float)
        idx = np.random.randint(0, len(returns_arr), size=(simulations, num_trades))
        outcomes = returns_arr[idx]
    else:
        # Parametric generation with realistic dispersion
        win_prob = max(0.05, min(float(win_rate) / 100.0, 0.95))
        rr = max(0.2, float(reward_risk))
        risk_amt = max(10.0, float(risk_per_trade))

        win_amt = risk_amt * rr
        loss_amt = -risk_amt

        # Bernoulli wins/losses
        wins = np.random.rand(simulations, num_trades) < win_prob
        # Log-normal or Gaussian noise so payoffs are not robotic
        noise = np.random.normal(1.0, 0.12, size=(simulations, num_trades))
        noise = np.clip(noise, 0.6, 1.8)

        outcomes = np.where(wins, win_amt * noise, loss_amt * noise)

    # Cumulative equity trajectories: shape (simulations, num_trades + 1)
    cum_returns = np.zeros((simulations, num_trades + 1))
    cum_returns[:, 1:] = np.cumsum(outcomes, axis=1)
    equity_paths = initial_balance + cum_returns

    # Running maximum along each path for drawdown
    running_max = np.maximum.accumulate(equity_paths, axis=1)
    drawdowns = (running_max - equity_paths) / np.maximum(running_max, 1.0)
    max_drawdowns = np.max(drawdowns, axis=1) * 100.0  # in percentage

    # Risk of Ruin
    ruin_level = initial_balance * (1.0 - (ruin_threshold_pct / 100.0))
    min_equity_per_sim = np.min(equity_paths, axis=1)
    ruined_count = int(np.sum(min_equity_per_sim <= ruin_level))
    risk_of_ruin_pct = round(float((ruined_count / simulations) * 100.0), 2)

    # Max consecutive losses per path
    is_loss = outcomes <= 0
    max_consec_losses = []
    for row in is_loss:
        longest = 0
        current = 0
        for l in row:
            if l:
                current += 1
                if current > longest:
                    longest = current
            else:
                current = 0
        max_consec_losses.append(longest)
    max_consec_losses = np.array(max_consec_losses)

    # Fan chart curves across the sequence
    p95_curve = [round(float(v), 2) for v in np.percentile(equity_paths, 95, axis=0)]
    p50_curve = [round(float(v), 2) for v in np.percentile(equity_paths, 50, axis=0)]
    p05_curve = [round(float(v), 2) for v in np.percentile(equity_paths, 5, axis=0)]

    worst_idx = int(np.argmin(equity_paths[:, -1]))
    worst_curve = [round(float(v), 2) for v in equity_paths[worst_idx]]

    best_idx = int(np.argmax(equity_paths[:, -1]))
    best_curve = [round(float(v), 2) for v in equity_paths[best_idx]]

    # Sample 6 representative background lines for visual fan effect
    sample_idxs = np.linspace(0, simulations - 1, 6, dtype=int)
    sampled_paths = [[round(float(v), 2) for v in equity_paths[i]] for i in sample_idxs]

    # Metrics
    final_equities = equity_paths[:, -1]
    median_final_equity = round(float(np.median(final_equities)), 2)
    median_profit = round(float(median_final_equity - initial_balance), 2)
    median_return_pct = round(float((median_profit / initial_balance) * 100.0), 2)

    dd_95 = round(float(np.percentile(max_drawdowns, 95)), 2)
    dd_avg = round(float(np.mean(max_drawdowns)), 2)
    dd_max = round(float(np.max(max_drawdowns)), 2)

    mcl_95 = int(np.percentile(max_consec_losses, 95))
    mcl_max = int(np.max(max_consec_losses))

    # Lot size recommendation: target max drawdown <= 10%
    if dd_95 > 0:
        recommended_lot = round(min(1.0, max(0.01, lot_size * (8.0 / dd_95))), 2)
    else:
        recommended_lot = lot_size

    # Histogram of max drawdowns
    bins = [0, 5, 10, 15, 20, 30, 50, 100]
    hist_counts, _ = np.histogram(max_drawdowns, bins=bins)
    histogram_data = []
    for i in range(len(hist_counts)):
        histogram_data.append({
            "range": f"{bins[i]}-{bins[i+1]}%",
            "count": int(hist_counts[i]),
            "pct": round(float((hist_counts[i] / simulations) * 100.0), 1),
        })

    # Survivability Grade
    if risk_of_ruin_pct == 0 and dd_95 <= 8.0:
        grade = "A+"
        grade_desc = "Institutional Grade - Exceptionally Safe"
        grade_color = "#089981"
    elif risk_of_ruin_pct <= 1.0 and dd_95 <= 14.0:
        grade = "A"
        grade_desc = "Strong Edge - Professional Risk Profile"
        grade_color = "#2962ff"
    elif risk_of_ruin_pct <= 3.0 and dd_95 <= 22.0:
        grade = "B"
        grade_desc = "Viable - Moderate Drawdown Variance"
        grade_color = "#f7a600"
    elif risk_of_ruin_pct <= 8.0:
        grade = "C"
        grade_desc = "Caution - Elevated Risk of Ruin"
        grade_color = "#ff6d00"
    else:
        grade = "HIGH RISK"
        grade_desc = "Dangerous - Account Blowout Likely"
        grade_color = "#f23645"

    return {
        "success": True,
        "config": {
            "initial_balance": initial_balance,
            "simulations": simulations,
            "num_trades": num_trades,
            "win_rate": win_rate,
            "reward_risk": reward_risk,
            "risk_per_trade": risk_per_trade,
            "lot_size": lot_size,
            "ruin_threshold_pct": ruin_threshold_pct,
        },
        "curves": {
            "p95": p95_curve,
            "p50": p50_curve,
            "p05": p05_curve,
            "worst": worst_curve,
            "best": best_curve,
            "samples": sampled_paths,
        },
        "stats": {
            "risk_of_ruin_pct": risk_of_ruin_pct,
            "dd_95": dd_95,
            "dd_avg": dd_avg,
            "dd_max": dd_max,
            "mcl_95": mcl_95,
            "mcl_max": mcl_max,
            "median_final_equity": median_final_equity,
            "median_profit": median_profit,
            "median_return_pct": median_return_pct,
            "recommended_lot": recommended_lot,
            "grade": grade,
            "grade_desc": grade_desc,
            "grade_color": grade_color,
        },
        "histogram": histogram_data,
    }
