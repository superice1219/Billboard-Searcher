"""Update billboard_data.json with latest chart data."""

import json
import sys
import time
from datetime import datetime

from scraper import get_chart, get_missing_weeks, chart_key

DATA_FILE = "billboard_data.json"


def load_data() -> dict:
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(data: dict):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def find_latest_date(data: dict) -> str:
    """Find the most recent date across all songs."""
    latest = "1958-01-01"
    for entries in data.values():
        for entry in entries:
            if entry["date"] > latest:
                latest = entry["date"]
    return latest


def update_data():
    print("Loading existing data...")
    data = load_data()
    latest_date = find_latest_date(data)
    print(f"Latest date in data: {latest_date}")

    missing_weeks = get_missing_weeks(latest_date)
    print(f"Missing weeks: {len(missing_weeks)}")
    if missing_weeks:
        print(f"  From: {missing_weeks[0]}")
        print(f"  To:   {missing_weeks[-1]}")

    if not missing_weeks:
        print("Data is already up to date!")
        return

    new_songs = 0
    new_entries = 0

    for i, week_date in enumerate(missing_weeks):
        print(f"[{i+1}/{len(missing_weeks)}] Fetching {week_date}...", end=" ")
        sys.stdout.flush()

        try:
            chart = get_chart(week_date)
        except Exception as e:
            print(f"ERROR: {e}")
            continue

        if len(chart) < 50:
            print(f"WARNING: only {len(chart)} entries, skipping")
            continue

        for entry in chart:
            key = chart_key(entry["title"], entry["artist"])
            chart_entry = {
                "date": week_date,
                "rank": entry["rank"],
                "weeks": entry["weeks"],
            }
            if key not in data:
                data[key] = []
                new_songs += 1
            data[key].append(chart_entry)
            new_entries += 1

        print(f"{len(chart)} songs")

        if i < len(missing_weeks) - 1:
            time.sleep(2)

    print(f"\nSaving data...")
    save_data(data)
    print(f"Done! Added {new_entries} entries across {new_songs} new songs.")


if __name__ == "__main__":
    update_data()
