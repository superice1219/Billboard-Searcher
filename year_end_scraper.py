"""Scrape Billboard Year-End Hot 100 charts for all available years."""

import json
import sys
import time

import requests
from bs4 import BeautifulSoup

YEAR_END_URL = "https://www.billboard.com/charts/year-end/{year}/hot-100-songs/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_year_end(year: int) -> list[dict]:
    """Fetch year-end chart for a given year. Returns list of {rank, title, artist}."""
    url = YEAR_END_URL.format(year=year)
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []

    for row in soup.find_all("ul", class_="o-chart-results-list-row"):
        lis = row.find_all("li", recursive=False)
        if len(lis) < 3:
            continue

        # Rank from first li
        rank_span = lis[0].find("span")
        if not rank_span:
            continue
        try:
            rank = int(rank_span.get_text(strip=True))
        except ValueError:
            continue

        # Title and artist from third li (nested)
        title = ""
        artist = ""
        container = lis[2]
        h3 = container.find("h3", id="title-of-a-story")
        if h3:
            title = h3.get_text(strip=True)
        span = container.find("span")
        if span:
            artist = span.get_text(strip=True)

        if title:
            results.append({"rank": rank, "title": title, "artist": artist})

    return results


def scrape_all_years(start_year: int = 1958, end_year: int = 2025) -> dict:
    """Scrape all year-end charts and return as dict keyed by year."""
    data = {}
    total_years = end_year - start_year + 1

    for i, year in enumerate(range(start_year, end_year + 1)):
        print(f"[{i+1}/{total_years}] Fetching {year}...", end=" ")
        sys.stdout.flush()

        try:
            chart = fetch_year_end(year)
        except Exception as e:
            print(f"ERROR: {e}")
            continue

        if len(chart) < 30:
            print(f"WARNING: only {len(chart)} entries (expected >= 50)")

        data[str(year)] = chart
        print(f"{len(chart)} songs")

        if i < total_years - 1:
            time.sleep(1)

    return data


def main():
    print("Scraping Billboard Year-End Hot 100 charts...")
    print(f"Years: 1958 - 2025 ({2025 - 1958 + 1} years)\n")

    data = scrape_all_years()

    total_entries = sum(len(v) for v in data.values())
    print(f"\nTotal: {len(data)} years, {total_entries} entries")

    output_file = "billboard_year_end.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Saved to {output_file}")


if __name__ == "__main__":
    main()
