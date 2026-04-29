"""Billboard Hot 100 scraper using requests + BeautifulSoup."""

import re
import time
from datetime import datetime, timedelta

import requests
from bs4 import BeautifulSoup

CHART_URL = "https://www.billboard.com/charts/hot-100/{date}/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_chart(date_str: str) -> list[dict]:
    """Fetch Billboard Hot 100 for a given Saturday date (YYYY-MM-DD).

    Returns list of {title, artist, rank, last_week, peak, weeks}.
    """
    url = CHART_URL.format(date=date_str)
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []

    for row in soup.find_all("ul", class_="o-chart-results-list-row"):
        lis = row.find_all("li")
        if len(lis) < 9:
            continue

        # li[0]: current rank
        rank_span = lis[0].find("span")
        if not rank_span:
            continue
        try:
            rank = int(rank_span.get_text(strip=True))
        except ValueError:
            continue

        # li[3] or li[4]: title + artist
        title = ""
        artist = ""
        for idx in (3, 4):
            if idx >= len(lis):
                continue
            h3 = lis[idx].find("h3")
            if h3:
                title = h3.get_text(strip=True)
                # First span that's not a stat label
                spans = lis[idx].find_all("span")
                for s in spans:
                    txt = s.get_text(strip=True)
                    if txt and txt != title and txt not in ("LW", "PEAK", "WEEKS", "-", "RE-\nENTRY") and not txt.isdigit():
                        artist = txt
                        break
                if title:
                    break

        if not title:
            continue

        # li[6]: last week, li[7]: peak, li[8]: weeks on chart
        def _get_span_num(idx: int) -> int:
            if idx >= len(lis):
                return 0
            span = lis[idx].find("span")
            if span:
                try:
                    return int(span.get_text(strip=True))
                except ValueError:
                    return 0
            return 0

        last_week = _get_span_num(6)
        peak = _get_span_num(7)
        weeks = _get_span_num(8)

        results.append({
            "title": title,
            "artist": artist,
            "rank": rank,
            "last_week": last_week,
            "peak": peak,
            "weeks": weeks,
        })

    return results


def get_chart(date_str: str = None) -> list[dict]:
    """Fetch chart. If date_str is None, fetches the latest available chart."""
    if date_str is None:
        date_str = _latest_chart_date()
    return fetch_chart(date_str)


def get_missing_weeks(since_date: str, until_date: str = None) -> list[str]:
    """Generate list of Saturday dates between since_date and until_date (exclusive)."""
    if until_date is None:
        until_date = _latest_chart_date()

    start = datetime.fromisoformat(since_date)
    end = datetime.fromisoformat(until_date)

    # Billboard chart dates are Saturdays
    # Find the next Saturday after start
    days_until_sat = (5 - start.weekday()) % 7
    if days_until_sat == 0:
        days_until_sat = 7
    current = start + timedelta(days=days_until_sat)

    dates = []
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(weeks=1)

    return dates


def chart_key(title: str, artist: str) -> str:
    """Generate a key matching the existing data format: 'Title - Artist'"""
    return f"{title} - {artist}"


def _latest_chart_date() -> str:
    """Most recent Saturday that has a published Billboard chart."""
    today = datetime.now()
    # Billboard chart date is the Saturday of the publish week.
    # Published on Tuesday, dated the following Saturday.
    # In practice the latest available is last Saturday.
    days_since_sat = (today.weekday() - 5) % 7
    if days_since_sat == 0:
        days_since_sat = 7
    latest = today - timedelta(days=days_since_sat)
    return latest.strftime("%Y-%m-%d")


if __name__ == "__main__":
    results = get_chart()
    print(f"Fetched {len(results)} songs (date: {_latest_chart_date()})")
    for entry in results[:10]:
        print(
            f"  #{entry['rank']:>3}: {entry['title']} - {entry['artist']} "
            f"(LW:{entry['last_week']}, PK:{entry['peak']}, WKS:{entry['weeks']})"
        )
