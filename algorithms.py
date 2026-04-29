"""Billboard ranking algorithms: custom time-span ranking and year-end prediction.

Algorithm 1 — Custom Time-Span Ranking
  Uses inverse-rank points (Billboard methodology):
    points = Σ (101 - rank) for each week in [start, end]
  Songs ranked by total accumulated points.

Algorithm 2 — Year-End Prediction
  1. Determine the tracking period (~Nov prev year to ~Nov target year).
  2. Calculate YTD actual points from weekly data.
  3. For songs still on the chart, project future performance using:
     - Recent rank trajectory (4-week drift rate)
     - Estimated remaining weeks based on current position and longevity
     - Exponential decay model for rank projection
  4. Merge actual + projected points, re-rank, return top 100.
"""

from collections import defaultdict
from datetime import datetime, timedelta


def inverse_rank_points(rank: int) -> float:
    """Weighted rank points — top positions get disproportionately more.

    Real Billboard year-end formula is based on raw consumption data
    (sales + streams + airplay), not just chart position. Since we
    only have position data, we simulate the curve with:

      Base:   101 - rank                    (linear, #1=100, #100=1)
      Bonus:  position multiplier for top slots

    Total = base * multiplier
    """
    base = float(101 - rank)

    # Position multiplier — #1 songs typically have far more consumption
    # than even #2, so top positions get weighted more heavily.
    if rank == 1:
        multiplier = 2.0       # #1 gets double
    elif rank <= 3:
        multiplier = 1.5
    elif rank <= 5:
        multiplier = 1.35
    elif rank <= 10:
        multiplier = 1.15
    elif rank <= 20:
        multiplier = 1.05
    else:
        multiplier = 1.0

    return round(base * multiplier, 1)


def _calculate_streaks(entries: list[dict]) -> dict:
    """Analyze chart run for streaks and compute bonus points.

    - #1 streak: each consecutive week at #1 earns escalating bonus
      (week 1 = +10, week 2 = +15, week 3 = +20, ... capping at +50/wk)
    - Top 5 streak: consecutive weeks in top 5 get +3/wk after week 2
    - Top 10 streak: consecutive weeks in top 10 get +1/wk after week 4

    Returns {"streaks": [...], "bonus": total_bonus}
    """
    bonus = 0.0
    streak_info = []

    if not entries:
        return {"streaks": [], "bonus": 0.0}

    # #1 streak detection
    current_num1_streak = 0
    for e in entries:
        if e["rank"] == 1:
            current_num1_streak += 1
            # Escalating bonus: 10, 15, 20, 25, 30, 35, 40, 45, 50, 50, ...
            week_bonus = min(10 + current_num1_streak * 5, 50)
            bonus += week_bonus
        else:
            if current_num1_streak >= 2:
                streak_info.append(f"#{current_num1_streak}wk #1 streak")
            current_num1_streak = 0

    # Flush any remaining #1 streak
    if current_num1_streak >= 2:
        streak_info.append(f"#{current_num1_streak}wk #1 streak")

    # Top 5 streak (consecutive weeks in top 5)
    top5_streak = 0
    for e in entries:
        if e["rank"] <= 5:
            top5_streak += 1
            if top5_streak > 2:
                bonus += 3
        else:
            top5_streak = 0

    # Top 10 streak (consecutive weeks in top 10)
    top10_streak = 0
    for e in entries:
        if e["rank"] <= 10:
            top10_streak += 1
            if top10_streak > 4:
                bonus += 1
        else:
            top10_streak = 0

    return {"streaks": streak_info, "bonus": round(bonus, 1)}


def _tracking_period(year: int) -> tuple[str, str]:
    """Estimate Billboard tracking period for a given year-end chart.

    Billboard year-end charts typically track from mid-November of the
    previous year through mid-November of the target year.
    """
    start = f"{year - 1}-11-15"
    end = f"{year}-11-15"
    return start, end


# ---- Algorithm 1: Custom Time-Span Ranking ----


def span_ranking(
    chart_data: dict,
    start_date: str,
    end_date: str,
    limit: int = 100,
) -> list[dict]:
    """Rank songs by accumulated inverse-rank points over [start, end].

    Args:
        chart_data: {key: [{date, rank, weeks}, ...]} as loaded from JSON.
        start_date, end_date: ISO dates (inclusive).
        limit: max results.

    Returns:
        [{key, title, artist, points, weeks_on, peak_rank, best_week}, ...]
        sorted by points descending.
    """
    song_points: dict[str, float] = defaultdict(float)
    song_weeks: dict[str, int] = defaultdict(int)
    song_peak: dict[str, int] = {}
    song_best_week: dict[str, str] = {}

    for key, entries in chart_data.items():
        # Filter entries in the date range and sort chronologically
        range_entries = sorted(
            [e for e in entries if start_date <= e["date"] <= end_date],
            key=lambda e: e["date"],
        )
        if not range_entries:
            continue

        # Accumulate base weighted points
        for e in range_entries:
            song_points[key] += inverse_rank_points(e["rank"])
            song_weeks[key] += 1
            if key not in song_peak or e["rank"] < song_peak[key]:
                song_peak[key] = e["rank"]
                song_best_week[key] = e["date"]

        # --- Streak bonuses ---
        # Consecutive weeks at #1 compound: real charts reward sustained #1s
        streak = _calculate_streaks(range_entries)
        song_points[key] += streak["bonus"]

    ranked = sorted(song_points.items(), key=lambda x: x[1], reverse=True)[:limit]

    results = []
    for key, points in ranked:
        title, artist = _split_key(key)
        results.append({
            "key": key,
            "title": title,
            "artist": artist,
            "points": round(points, 1),
            "weeks_on": song_weeks[key],
            "peak_rank": song_peak[key],
            "best_week": song_best_week[key],
        })
    return results


# ---- Algorithm 2: Year-End Prediction ----


def predict_year_end(
    chart_data: dict,
    year: int = 2026,
    latest_date: str = None,
) -> list[dict]:
    """Predict year-end Hot 100 ranking for a given year.

    Methodology:
      1. Compute actual YTD points from tracking start to latest_date.
      2. For songs currently charting, project remaining weeks using:
         - 4-week rank drift trend
         - Position-based longevity estimate
      3. Sum actual + projected points for final ranking.

    Args:
        chart_data: Full chart data.
        year: Target year for prediction.
        latest_date: Most recent chart date available.

    Returns:
        [{key, title, artist, actual_pts, projected_pts, total_pts, rank}, ...]
    """
    if latest_date is None:
        latest_date = _find_latest_date(chart_data)

    tracking_start, tracking_end = _tracking_period(year)

    # Weeks in tracking period
    total_weeks = _count_saturdays(tracking_start, tracking_end)
    elapsed_weeks = _count_saturdays(tracking_start, latest_date)
    remaining_weeks = total_weeks - elapsed_weeks
    print(f"Prediction for {year}: {elapsed_weeks}/{total_weeks} weeks elapsed, "
          f"{remaining_weeks} remaining")

    # Step 1: YTD actual points
    ytd = span_ranking(chart_data, tracking_start, latest_date, limit=99999)
    ytd_map = {s["key"]: s for s in ytd}

    # Step 2: Get current chart (latest week)
    current_chart = _get_chart_at_date(chart_data, latest_date)
    print(f"Current chart: {len(current_chart)} songs")

    # Step 3: For each song on current chart, project future points
    projections = {}
    for key, current_rank in current_chart.items():
        entries = chart_data.get(key, [])
        if not entries:
            continue

        # Get recent trajectory
        recent = [e for e in entries
                  if tracking_start <= e["date"] <= latest_date]
        recent.sort(key=lambda e: e["date"])

        future_pts = _project_future_points(
            recent, current_rank, remaining_weeks, latest_date
        )
        projections[key] = future_pts

    # Step 4: Merge actual + projected
    final: dict[str, dict] = {}
    all_keys = set(ytd_map.keys()) | set(projections.keys())

    for key in all_keys:
        actual = ytd_map[key]["points"] if key in ytd_map else 0
        projected = projections.get(key, 0)
        total = actual + projected

        title, artist = _split_key(key)
        peak = ytd_map[key]["peak_rank"] if key in ytd_map else current_chart.get(key, 999)
        weeks = ytd_map[key]["weeks_on"] if key in ytd_map else 0

        final[key] = {
            "key": key,
            "title": title,
            "artist": artist,
            "actual_pts": round(actual, 1),
            "projected_pts": round(projected, 1),
            "total_pts": round(total, 1),
            "peak_rank": peak,
            "weeks_on": weeks,
            "current_rank": current_chart.get(key),
        }

    ranked = sorted(final.items(), key=lambda x: x[1]["total_pts"], reverse=True)
    results = []
    for i, (key, info) in enumerate(ranked[:100]):
        info["predicted_rank"] = i + 1
        results.append(info)

    return results


def _project_future_points(
    recent_entries: list[dict],
    current_rank: int,
    remaining_weeks: int,
    latest_date: str,
) -> float:
    """Project future points for a song based on its trajectory.

    Uses a rank-drift + decay model:
      - Calculate average weekly rank change over last 4 weeks
      - Estimate how many more weeks the song will stay
      - Project rank forward using drift with gradual deceleration
      - Accumulate inverse-rank points
    """
    if not recent_entries:
        return 0.0

    # Calculate 4-week drift (positive = falling, negative = rising)
    ranks = [e["rank"] for e in recent_entries[-5:]]  # up to 5 weeks
    if len(ranks) >= 2:
        drifts = [ranks[i + 1] - ranks[i] for i in range(len(ranks) - 1)]
        avg_drift = sum(drifts) / len(drifts)
    else:
        avg_drift = 0.0

    # Estimate remaining chart life based on current rank + weeks accrued
    weeks_on = len(recent_entries)
    expected_total = _expected_longevity(current_rank, weeks_on)
    song_remaining = max(0, expected_total - weeks_on)
    song_remaining = min(song_remaining, remaining_weeks)

    if song_remaining <= 0:
        return 0.0

    # Clamp drift: songs don't rise/fall too fast
    drift = max(-8.0, min(8.0, avg_drift))
    # Add reversion to mean: songs far from top tend to fall faster
    drift += (current_rank - 50) * 0.002

    total_pts = 0.0
    rank = float(current_rank)

    for week in range(int(song_remaining)):
        # Apply drift with damping (trajectory decelerates over time)
        damping = 1.0 / (1.0 + week * 0.15)
        rank += drift * damping

        # Add random-walk noise that increases with time
        rank += (week * 0.3)  # slight upward (worsening) pressure

        # Clamp to chart range
        rank = max(1.0, min(100.0, rank))

        pts = 101.0 - rank
        total_pts += max(0.0, pts)

        # If rank drifts past 100, song falls off
        if rank >= 99.5:
            break

    return round(total_pts, 1)


def _expected_longevity(current_rank: int, weeks_so_far: int) -> int:
    """Estimate total weeks a song will spend on chart.

    Based on historical patterns: songs near #1 tend to stay longer,
    but the relationship is noisy. Uses current rank as primary signal.
    """
    # Base longevity estimates by rank tier
    if current_rank <= 5:
        base = 35
    elif current_rank <= 10:
        base = 28
    elif current_rank <= 20:
        base = 22
    elif current_rank <= 40:
        base = 16
    elif current_rank <= 70:
        base = 10
    else:
        base = 6

    # If song has already been on chart a while, it may persist longer
    if weeks_so_far > base:
        base = weeks_so_far + max(2, int((100 - current_rank) * 0.1))

    return base


# ---- Helpers ----


def _split_key(key: str) -> tuple[str, str]:
    parts = key.split(" - ", 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return key, ""


def _find_latest_date(chart_data: dict) -> str:
    latest = "1958-01-01"
    for entries in chart_data.values():
        for e in entries:
            if e["date"] > latest:
                latest = e["date"]
    return latest


def _count_saturdays(start: str, end: str) -> int:
    """Count Saturdays between two dates (inclusive)."""
    s = datetime.fromisoformat(start)
    e = datetime.fromisoformat(end)
    # Adjust to Saturday
    days_to_sat = (5 - s.weekday()) % 7
    if days_to_sat == 0:
        days_to_sat = 7
    cur = s + timedelta(days=days_to_sat)
    count = 0
    while cur <= e:
        count += 1
        cur += timedelta(weeks=1)
    return count


def _get_chart_at_date(chart_data: dict, date_str: str) -> dict[str, int]:
    """Return {song_key: rank} for a given date."""
    result = {}
    for key, entries in chart_data.items():
        for e in entries:
            if e["date"] == date_str:
                result[key] = e["rank"]
                break
    return result


# ---- Test ----
if __name__ == "__main__":
    import json

    with open("billboard_data.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    print("=" * 60)
    print("Test 1: Custom Time-Span Ranking (2025 full year)")
    print("=" * 60)
    results = span_ranking(data, "2025-01-01", "2025-12-31", limit=10)
    for r in results:
        print(f"  #{r['points']:>5}pts: {r['title']} - {r['artist']} "
              f"(peak:#{r['peak_rank']}, {r['weeks_on']}wks)")

    print()
    print("=" * 60)
    print("Test 2: 2026 Year-End Prediction")
    print("=" * 60)
    pred = predict_year_end(data, year=2026)
    for r in pred[:20]:
        cur = f"now:#{r['current_rank']}" if r['current_rank'] else "off-chart"
        print(f"  #{r['predicted_rank']:>3}: {r['title'][:40]} - {r['artist'][:25]}")
        print(f"       actual:{r['actual_pts']:>6} + proj:{r['projected_pts']:>6} "
              f"= total:{r['total_pts']:>6}  ({cur})")
