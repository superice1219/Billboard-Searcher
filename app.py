"""Flask backend for Billboard chart query web app."""

import json
import os
import re
import threading
from datetime import datetime

from flask import Flask, jsonify, render_template, request

from scraper import get_chart, chart_key
from update_data import load_data, save_data, find_latest_date, get_missing_weeks
from algorithms import span_ranking, predict_year_end

app = Flask(__name__)

DATA_FILE = "billboard_data.json"
YEAR_END_FILE = "billboard_year_end.json"

# Global in-memory data store
chart_data: dict = {}
songs_by_date: dict = {}  # date -> [(rank, key), ...]
available_dates: list[str] = []
year_end_data: dict = {}  # year -> [{"rank":..., "title":..., "artist":...}, ...]
year_end_years: list[int] = []
_update_lock = threading.Lock()


def build_indexes():
    """Build fast-lookup indexes from the raw data."""
    global chart_data, songs_by_date, available_dates, year_end_data, year_end_years

    if os.path.exists(DATA_FILE):
        chart_data = load_data()
    else:
        print(f"Warning: {DATA_FILE} not found")

    if os.path.exists(YEAR_END_FILE):
        with open(YEAR_END_FILE, "r", encoding="utf-8") as f:
            year_end_data = json.load(f)
        year_end_years = sorted([int(y) for y in year_end_data.keys()], reverse=True)
        print(f"Loaded {len(year_end_data)} year-end charts")
    else:
        print(f"Warning: {YEAR_END_FILE} not found")

    # Build date index
    songs_by_date = {}
    for key, entries in chart_data.items():
        for entry in entries:
            d = entry["date"]
            if d not in songs_by_date:
                songs_by_date[d] = []
            songs_by_date[d].append((entry["rank"], key))

    # Sort each date's songs by rank
    for d in songs_by_date:
        songs_by_date[d].sort(key=lambda x: x[0])

    available_dates = sorted(songs_by_date.keys(), reverse=True)

    print(f"Loaded {len(chart_data)} songs, {len(available_dates)} chart weeks")


def get_current_week_data():
    """Get the latest chart week's data with full song info."""
    if not available_dates:
        # Try fetching live
        try:
            chart = get_chart()
            return chart
        except Exception:
            return []

    latest_date = available_dates[0]
    songs = []
    for rank, key in songs_by_date.get(latest_date, []):
        entry_data = chart_data.get(key, [])
        # Find the entry for this specific date
        for e in entry_data:
            if e["date"] == latest_date:
                songs.append({
                    "key": key,
                    "rank": rank,
                    "title": _split_key(key)[0],
                    "artist": _split_key(key)[1],
                    "weeks": e["weeks"],
                })
                break
    return songs


def _split_key(key: str) -> tuple:
    """Split 'Title - Artist' into (title, artist)."""
    parts = key.split(" - ", 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return key, ""


def search_songs(query: str, limit: int = 50) -> list:
    """Search songs by title or artist."""
    q = query.lower()
    results = []
    for key in chart_data:
        title, artist = _split_key(key)
        if q in title.lower() or q in artist.lower():
            # Get the latest entry
            entries = chart_data[key]
            latest = entries[-1] if entries else None
            results.append({
                "key": key,
                "title": title,
                "artist": artist,
                "latest_rank": latest["rank"] if latest else None,
                "latest_date": latest["date"] if latest else None,
                "total_weeks": len(entries),
                "peak_rank": min(e["rank"] for e in entries) if entries else None,
            })
    # Sort by relevance (exact match first, then by latest popularity)
    results.sort(key=lambda r: (
        0 if q == r["title"].lower() else 1,
        r["latest_rank"] or 999,
    ))
    return results[:limit]


# ---- Routes ----

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/current")
def api_current():
    return jsonify(get_current_week_data())


@app.route("/api/song/<path:key>")
def api_song(key):
    if key not in chart_data:
        return jsonify({"error": "Song not found"}), 404

    entries = sorted(chart_data[key], key=lambda e: e["date"])
    title, artist = _split_key(key)
    peak_rank = min(e["rank"] for e in entries)
    peak_weeks = sum(1 for e in entries if e["rank"] == peak_rank)

    # Find year-end rankings for this song
    ye_ranks = []
    norm_artist = _normalize_artist(artist)
    for ye_year, songs in year_end_data.items():
        for s in songs:
            if s["title"].lower() == title.lower():
                ye_artist = _normalize_artist(s["artist"])
                if ye_artist.lower() == norm_artist.lower():
                    ye_ranks.append({"year": int(ye_year), "rank": s["rank"]})
                    break

    return jsonify({
        "key": key,
        "title": title,
        "artist": artist,
        "peak_rank": peak_rank,
        "peak_weeks": peak_weeks,
        "total_weeks": len(entries),
        "first_date": entries[0]["date"],
        "latest_date": entries[-1]["date"],
        "year_end_ranks": sorted(ye_ranks, key=lambda r: r["year"], reverse=True),
        "chart_run": entries,
    })


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "")
    if len(q) < 1:
        return jsonify([])
    return jsonify(search_songs(q))


@app.route("/api/artist/<path:name>")
def api_artist(name):
    """Return all songs by a given artist, with chart stats."""
    name_lower = name.lower().strip()
    results = []

    for key, entries in chart_data.items():
        title, artist = _split_key(key)
        if name_lower in artist.lower():
            # Search matching: artist name appears in the artist field
            sorted_entries = sorted(entries, key=lambda e: e["date"])
            peak = min(e["rank"] for e in entries)
            results.append({
                "key": key,
                "title": title,
                "artist": artist,
                "peak_rank": peak,
                "total_weeks": len(entries),
                "first_date": sorted_entries[0]["date"],
                "latest_date": sorted_entries[-1]["date"],
                "latest_rank": sorted_entries[-1]["rank"],
            })

    # Sort: peak rank first, then by total weeks
    results.sort(key=lambda r: (r["peak_rank"], -r["total_weeks"]))

    # Count #1 hits
    number_ones = sum(1 for r in results if r["peak_rank"] == 1)
    top10 = sum(1 for r in results if r["peak_rank"] <= 10)

    return jsonify({
        "artist": name,
        "total_songs": len(results),
        "number_ones": number_ones,
        "top10_hits": top10,
        "songs": results,
    })


@app.route("/api/dates")
def api_dates():
    return jsonify(available_dates)


@app.route("/api/chart/<date>")
def api_chart_by_date(date):
    if date not in songs_by_date:
        return jsonify({"error": "Date not found"}), 404

    songs = []
    for rank, key in songs_by_date[date]:
        entry_data = chart_data.get(key, [])
        for e in entry_data:
            if e["date"] == date:
                songs.append({
                    "key": key,
                    "rank": rank,
                    "title": _split_key(key)[0],
                    "artist": _split_key(key)[1],
                    "weeks": e["weeks"],
                })
                break
    return jsonify(songs)


@app.route("/api/check-update")
def api_check_update():
    """Check if newer Billboard data is available online."""
    from scraper import _latest_chart_date

    data_latest = find_latest_date(chart_data) if chart_data else "1958-01-01"
    online_latest = _latest_chart_date()
    missing = get_missing_weeks(data_latest)

    return jsonify({
        "data_latest": data_latest,
        "online_latest": online_latest,
        "outdated": len(missing) > 0,
        "missing_weeks": len(missing),
    })


@app.route("/api/update", methods=["POST"])
def api_update():
    """Trigger a data update. Runs synchronously for now."""
    if _update_lock.locked():
        return jsonify({"status": "error", "message": "Update already in progress"}), 409

    def do_update():
        with _update_lock:
            try:
                latest_date = find_latest_date(chart_data)
                missing = get_missing_weeks(latest_date)
                if not missing:
                    return

                new_entries = 0
                new_songs = 0
                for week_date in missing:
                    try:
                        chart = get_chart(week_date)
                    except Exception:
                        continue
                    if len(chart) < 50:
                        continue
                    for entry in chart:
                        key = chart_key(entry["title"], entry["artist"])
                        ce = {"date": week_date, "rank": entry["rank"], "weeks": entry["weeks"]}
                        if key not in chart_data:
                            chart_data[key] = []
                            new_songs += 1
                        chart_data[key].append(ce)
                        new_entries += 1
                save_data(chart_data)
                build_indexes()
                print(f"Update complete: {new_entries} entries, {new_songs} new songs")
            except Exception as e:
                print(f"Update failed: {e}")

    thread = threading.Thread(target=do_update, daemon=True)
    thread.start()
    return jsonify({"status": "ok", "message": "Update started"})


@app.route("/api/year-end/years")
def api_year_end_years():
    """Return list of available year-end chart years."""
    return jsonify(year_end_years)


@app.route("/api/year-end/<int:year>")
def api_year_end(year):
    """Return year-end chart for a specific year."""
    year_key = str(year)
    if year_key not in year_end_data:
        return jsonify({"error": "Year not found"}), 404

    songs = year_end_data[year_key]
    enriched = []
    for s in songs:
        artist = _normalize_artist(s["artist"])
        # Try exact match first, then normalized
        weekly_key = f"{s['title']} - {s['artist']}"
        norm_key = f"{s['title']} - {artist}"
        lookup_key = norm_key if norm_key in chart_data else (
            weekly_key if weekly_key in chart_data else None
        )
        peak = None
        weeks = None
        peak_wks = None
        matched_key = norm_key
        if lookup_key:
            entries = chart_data[lookup_key]
            peak = min(e["rank"] for e in entries)
            peak_wks = sum(1 for e in entries if e["rank"] == peak)
            weeks = len(entries)
            matched_key = lookup_key
        else:
            # Last resort: fuzzy search in chart_data
            matched_key = _fuzzy_match_key(s["title"], s["artist"], chart_data)

        if matched_key:
            entries = chart_data[matched_key]
            peak = min(e["rank"] for e in entries)
            peak_wks = sum(1 for e in entries if e["rank"] == peak)
            weeks = len(entries)

        enriched.append({
            "rank": s["rank"],
            "title": s["title"],
            "artist": artist,  # normalized for display
            "key": matched_key or norm_key,
            "peak": peak,
            "peak_weeks": peak_wks,
            "weeks": weeks,
        })
    return jsonify(enriched)


def _normalize_artist(name: str) -> str:
    """Normalize artist name to match weekly chart data format.

    Billboard year-end pages compact the artist string (e.g.
    'Zach BryanFeaturingKacey Musgraves') while weekly pages use
    proper spacing ('Zach Bryan Featuring Kacey Musgraves').
    """
    # Add space around these join-words when adjacent to words
    for word in ("Featuring", "Feat", "With", "And", "X"):
        name = re.sub(rf"(\w)({word})(\w)", rf"\1 {word} \3", name)
    # Add space around & when not already spaced
    name = re.sub(r"(\w)&(\w)", r"\1 & \2", name)
    # Add space after comma when not followed by space
    name = re.sub(r",(\S)", r", \1", name)
    # Collapse multiple spaces
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _fuzzy_match_key(title: str, artist: str, data: dict) -> str | None:
    """Try to find a song key by matching title exactly when artist differs."""
    # Match by title alone (most titles are unique enough)
    for key in data:
        key_title, _ = _split_key(key)
        if key_title.lower() == title.lower():
            return key
    return None


@app.route("/api/rankings")
def api_rankings():
    """Custom time-span ranking."""
    start = request.args.get("start", "")
    end = request.args.get("end", "")
    if not start or not end:
        return jsonify({"error": "start and end parameters required"}), 400

    limit = request.args.get("limit", 100, type=int)
    results = span_ranking(chart_data, start, end, limit=limit)
    return jsonify({
        "start": start,
        "end": end,
        "results": results,
    })


@app.route("/api/predict/<int:year>")
def api_predict(year):
    """Predict year-end ranking for a given year."""
    latest = available_dates[0] if available_dates else None
    results = predict_year_end(chart_data, year=year, latest_date=latest)

    return jsonify({
        "year": year,
        "tracking_start": f"{year - 1}-11-15",
        "tracking_end": f"{year}-11-15",
        "latest_date": latest,
        "predictions": results,
    })


@app.route("/api/stats")
def api_stats():
    return jsonify({
        "total_songs": len(chart_data),
        "total_weeks": len(available_dates),
        "date_range": [available_dates[-1] if available_dates else None,
                       available_dates[0] if available_dates else None],
    })


if __name__ == "__main__":
    build_indexes()
    app.run(debug=True, port=5000)
