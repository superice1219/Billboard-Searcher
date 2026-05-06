import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const funcDir = fileURLToPath(new URL(".", import.meta.url));

// ── In-memory cache (persists between warm invocations) ──────────────
let chartData = null;
let yearEndData = null;
let songsByDate = null;
let availableDates = null;

function loadData() {
  if (chartData) return;
  const raw = readFileSync(join(funcDir, "billboard_data.json"), "utf-8");
  chartData = JSON.parse(raw);

  const yeRaw = readFileSync(join(funcDir, "billboard_year_end.json"), "utf-8");
  yearEndData = JSON.parse(yeRaw);

  songsByDate = {};
  for (const [key, entries] of Object.entries(chartData)) {
    for (const e of entries) {
      if (!songsByDate[e.date]) songsByDate[e.date] = [];
      songsByDate[e.date].push([e.rank, key]);
    }
  }
  for (const d of Object.keys(songsByDate)) {
    songsByDate[d].sort((a, b) => a[0] - b[0]);
  }
  availableDates = Object.keys(songsByDate).sort().reverse();
}

// ── Helpers ───────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function splitKey(key) {
  const idx = key.indexOf(" - ");
  if (idx === -1) return [key, ""];
  return [key.slice(0, idx), key.slice(idx + 3)];
}

function splitArtistNames(artist) {
  let s = artist.replace(/(\S)(Featuring|Feat\.|Feat|With|And|X)(\S)/gi, "$1 $2 $3");
  s = s.replace(/(\S)&(\S)/g, "$1 & $2");
  s = s.replace(/\s+/g, " ").trim();
  const parts = s.split(/\s+(?:Featuring|Feat\.|Feat|With|And|X|&)\s+/i);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function normalizeArtist(name) {
  for (const word of ["Featuring", "Feat", "With", "And", "X"]) {
    const re = new RegExp(`(\\w)(${word})(\\w)`, "gi");
    name = name.replace(re, "$1 $2 $3");
  }
  name = name.replace(/(\w)&(\w)/g, "$1 & $2");
  name = name.replace(/,(\S)/g, ", $1");
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

// ── Route handlers ────────────────────────────────────────────────────

function handleCurrent() {
  if (!availableDates.length) return json([]);
  const latestDate = availableDates[0];
  const songs = [];
  for (const [rank, key] of songsByDate[latestDate] || []) {
    const entries = chartData[key] || [];
    const e = entries.find((x) => x.date === latestDate);
    if (e) {
      const [title, artist] = splitKey(key);
      songs.push({ key, rank, title, artist, weeks: e.weeks });
    }
  }
  return json(songs);
}

function handleSong(key) {
  const decoded = decodeURIComponent(key);
  if (!chartData[decoded]) return json({ error: "Song not found" }, 404);
  const entries = [...chartData[decoded]].sort((a, b) => a.date.localeCompare(b.date));
  const [title, artist] = splitKey(decoded);
  const peakRank = Math.min(...entries.map((e) => e.rank));
  const peakWeeks = entries.filter((e) => e.rank === peakRank).length;

  // Year-end ranks
  const yeRanks = [];
  const normArtist = normalizeArtist(artist);
  for (const [yeYear, songs] of Object.entries(yearEndData)) {
    for (const s of songs) {
      if (s.title.toLowerCase() === title.toLowerCase()) {
        const yeArtist = normalizeArtist(s.artist);
        if (yeArtist.toLowerCase() === normArtist.toLowerCase()) {
          yeRanks.push({ year: parseInt(yeYear), rank: s.rank });
          break;
        }
      }
    }
  }
  yeRanks.sort((a, b) => b.year - a.year);

  return json({
    key: decoded,
    title,
    artist,
    peak_rank: peakRank,
    peak_weeks: peakWeeks,
    total_weeks: entries.length,
    first_date: entries[0].date,
    latest_date: entries[entries.length - 1].date,
    year_end_ranks: yeRanks,
    chart_run: entries,
  });
}

function handleSearch(q) {
  if (!q || q.length < 1) return json({ artists: [], songs: [] });
  const query = q.toLowerCase();

  // Search songs
  const songResults = [];
  for (const [key, entries] of Object.entries(chartData)) {
    const [title, artist] = splitKey(key);
    if (title.toLowerCase().includes(query) || artist.toLowerCase().includes(query)) {
      const latest = entries[entries.length - 1];
      songResults.push({
        key,
        title,
        artist,
        latest_rank: latest ? latest.rank : null,
        latest_date: latest ? latest.date : null,
        total_weeks: entries.length,
        peak_rank: Math.min(...entries.map((e) => e.rank)),
      });
    }
  }
  songResults.sort((a, b) => {
    const aExact = query === a.title.toLowerCase() ? 0 : 1;
    const bExact = query === b.title.toLowerCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return (a.latest_rank || 999) - (b.latest_rank || 999);
  });
  const songs = songResults.slice(0, 50);

  // Search artists
  const artistStats = {};
  for (const [key, entries] of Object.entries(chartData)) {
    const [, artist] = splitKey(key);
    const names = splitArtistNames(artist);
    const matched = names.filter((n) => n.toLowerCase().includes(query));
    if (!matched.length) continue;

    const peak = Math.min(...entries.map((e) => e.rank));
    for (const name of matched) {
      const keyLower = name.toLowerCase();
      if (!artistStats[keyLower]) {
        artistStats[keyLower] = {
          name,
          total_songs: 0,
          number_ones: 0,
          top10_hits: 0,
          best_peak: 999,
          best_title: "",
        };
      }
      const entry = artistStats[keyLower];
      entry.total_songs++;
      if (peak < entry.best_peak) {
        entry.best_peak = peak;
        entry.best_title = splitKey(key)[0];
      }
      if (peak === 1) entry.number_ones++;
      if (peak <= 10) entry.top10_hits++;
    }
  }

  const artists = Object.values(artistStats);
  artists.sort((a, b) => {
    const aExact = query === a.name.toLowerCase() ? 0 : 1;
    const bExact = query === b.name.toLowerCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return b.total_songs - a.total_songs;
  });

  return json({ artists, songs });
}

function handleArtist(name) {
  const nameLower = decodeURIComponent(name).toLowerCase().trim();
  const results = [];
  for (const [key, entries] of Object.entries(chartData)) {
    const [, artist] = splitKey(key);
    if (artist.toLowerCase().includes(nameLower)) {
      const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
      const peak = Math.min(...entries.map((e) => e.rank));
      results.push({
        key,
        title: splitKey(key)[0],
        artist,
        peak_rank: peak,
        total_weeks: entries.length,
        first_date: sorted[0].date,
        latest_date: sorted[sorted.length - 1].date,
        latest_rank: sorted[sorted.length - 1].rank,
      });
    }
  }
  results.sort((a, b) => a.peak_rank - b.peak_rank || b.total_weeks - a.total_weeks);
  const numberOnes = results.filter((r) => r.peak_rank === 1).length;
  const top10 = results.filter((r) => r.peak_rank <= 10).length;

  return json({
    artist: decodeURIComponent(name),
    total_songs: results.length,
    number_ones: numberOnes,
    top10_hits: top10,
    songs: results,
  });
}

function handleDates() {
  return json(availableDates);
}

function handleChartByDate(date) {
  if (!songsByDate[date]) return json({ error: "Date not found" }, 404);
  const songs = [];
  for (const [rank, key] of songsByDate[date]) {
    const entries = chartData[key] || [];
    const e = entries.find((x) => x.date === date);
    if (e) {
      const [title, artist] = splitKey(key);
      songs.push({ key, rank, title, artist, weeks: e.weeks });
    }
  }
  return json(songs);
}

function handleCheckUpdate() {
  // Simplified: returns basic info without scraping
  const dataLatest = availableDates.length ? availableDates[0] : "1958-01-01";

  // Calculate expected latest Saturday
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToSat = dayOfWeek === 6 ? 0 : 6 - dayOfWeek;
  const latestSat = new Date(now);
  latestSat.setDate(now.getDate() + daysToSat);
  const onlineLatest = latestSat.toISOString().slice(0, 10);

  const outdated = dataLatest < onlineLatest;

  return json({
    data_latest: dataLatest,
    online_latest: onlineLatest,
    outdated,
    missing_weeks: outdated ? 1 : 0,
  });
}

function handleYearEndYears() {
  const years = Object.keys(yearEndData)
    .map(Number)
    .sort((a, b) => b - a);
  return json(years);
}

function handleYearEnd(year) {
  const yearKey = String(year);
  if (!yearEndData[yearKey]) return json({ error: "Year not found" }, 404);

  const songs = yearEndData[yearKey];
  const enriched = [];
  for (const s of songs) {
    const artist = normalizeArtist(s.artist);
    const weeklyKey = `${s.title} - ${s.artist}`;
    const normKey = `${s.title} - ${artist}`;
    let lookupKey = null;
    if (chartData[normKey]) lookupKey = normKey;
    else if (chartData[weeklyKey]) lookupKey = weeklyKey;
    else {
      // Fuzzy match by title
      for (const k of Object.keys(chartData)) {
        if (splitKey(k)[0].toLowerCase() === s.title.toLowerCase()) {
          lookupKey = k;
          break;
        }
      }
    }

    let peak = null, weeks = null, peakWks = null;
    let matchedKey = normKey;
    if (lookupKey) {
      const entries = chartData[lookupKey];
      peak = Math.min(...entries.map((e) => e.rank));
      peakWks = entries.filter((e) => e.rank === peak).length;
      weeks = entries.length;
      matchedKey = lookupKey;
    }

    enriched.push({
      rank: s.rank,
      title: s.title,
      artist,
      key: matchedKey,
      peak,
      peak_weeks: peakWks,
      weeks,
    });
  }
  return json(enriched);
}

function handleStats() {
  return json({
    total_songs: Object.keys(chartData).length,
    total_weeks: availableDates.length,
    date_range: [
      availableDates.length ? availableDates[availableDates.length - 1] : null,
      availableDates.length ? availableDates[0] : null,
    ],
  });
}

// ── Span Ranking ──────────────────────────────────────────────────────

function inverseRankPoints(rank) {
  const base = 101 - rank;
  let multiplier;
  if (rank === 1) multiplier = 2.0;
  else if (rank <= 3) multiplier = 1.5;
  else if (rank <= 5) multiplier = 1.35;
  else if (rank <= 10) multiplier = 1.15;
  else if (rank <= 20) multiplier = 1.05;
  else multiplier = 1.0;
  return Math.round(base * multiplier * 10) / 10;
}

function calculateStreaks(entries) {
  let bonus = 0;
  const streaks = [];
  let num1Streak = 0;
  for (const e of entries) {
    if (e.rank === 1) {
      num1Streak++;
      bonus += Math.min(10 + num1Streak * 5, 50);
    } else {
      if (num1Streak >= 2) streaks.push(`#${num1Streak}wk #1 streak`);
      num1Streak = 0;
    }
  }
  if (num1Streak >= 2) streaks.push(`#${num1Streak}wk #1 streak`);

  let top5Streak = 0;
  for (const e of entries) {
    if (e.rank <= 5) {
      top5Streak++;
      if (top5Streak > 2) bonus += 3;
    } else {
      top5Streak = 0;
    }
  }

  let top10Streak = 0;
  for (const e of entries) {
    if (e.rank <= 10) {
      top10Streak++;
      if (top10Streak > 4) bonus += 1;
    } else {
      top10Streak = 0;
    }
  }

  return { streaks, bonus: Math.round(bonus * 10) / 10 };
}

function computeRankings(start, end, limit = 100) {
  if (!start || !end) return null;

  const songPoints = {};
  const songWeeks = {};
  const songPeak = {};
  const songBestWeek = {};
  const songPeakWeeks = {};

  for (const [key, entries] of Object.entries(chartData)) {
    const rangeEntries = entries
      .filter((e) => e.date >= start && e.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!rangeEntries.length) continue;

    for (const e of rangeEntries) {
      songPoints[key] = (songPoints[key] || 0) + inverseRankPoints(e.rank);
      songWeeks[key] = (songWeeks[key] || 0) + 1;
      if (!(key in songPeak) || e.rank < songPeak[key]) {
        songPeak[key] = e.rank;
        songBestWeek[key] = e.date;
        songPeakWeeks[key] = 1;
      } else if (e.rank === songPeak[key]) {
        songPeakWeeks[key]++;
      }
    }

    const streak = calculateStreaks(rangeEntries);
    songPoints[key] = (songPoints[key] || 0) + streak.bonus;
  }

  const ranked = Object.entries(songPoints)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const results = ranked.map(([key, points]) => {
    const [title, artist] = splitKey(key);
    return {
      key,
      title,
      artist,
      points: Math.round(points * 10) / 10,
      weeks_on: songWeeks[key],
      peak_rank: songPeak[key],
      peak_weeks: songPeakWeeks[key],
      best_week: songBestWeek[key],
    };
  });

  return { start, end, results };
}

function handleRankings(start, end, limit) {
  const data = computeRankings(start, end, limit);
  if (!data) return json({ error: "start and end parameters required" }, 400);
  return json(data);
}

// ── Year-End Prediction ───────────────────────────────────────────────

function countSaturdays(start, end) {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  let daysToSat = (6 - s.getUTCDay()) % 7;
  if (daysToSat === 0) daysToSat = 7;
  let cur = new Date(s);
  cur.setUTCDate(cur.getUTCDate() + daysToSat);
  let count = 0;
  while (cur <= e) {
    count++;
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return count;
}

function getChartAtDate(date) {
  const result = {};
  for (const [key, entries] of Object.entries(chartData)) {
    for (const e of entries) {
      if (e.date === date) {
        result[key] = e.rank;
        break;
      }
    }
  }
  return result;
}

function expectedLongevity(currentRank, weeksSoFar) {
  let base;
  if (currentRank <= 5) base = 35;
  else if (currentRank <= 10) base = 28;
  else if (currentRank <= 20) base = 22;
  else if (currentRank <= 40) base = 16;
  else if (currentRank <= 70) base = 10;
  else base = 6;
  if (weeksSoFar > base) base = weeksSoFar + Math.max(2, Math.floor((100 - currentRank) * 0.1));
  return base;
}

function projectFuturePoints(recentEntries, currentRank, remainingWeeks) {
  if (!recentEntries.length) return 0;

  const ranks = recentEntries.slice(-5).map((e) => e.rank);
  let avgDrift = 0;
  if (ranks.length >= 2) {
    let sum = 0;
    for (let i = 0; i < ranks.length - 1; i++) sum += ranks[i + 1] - ranks[i];
    avgDrift = sum / (ranks.length - 1);
  }

  const weeksOn = recentEntries.length;
  const expectedTotal = expectedLongevity(currentRank, weeksOn);
  let songRemaining = Math.max(0, expectedTotal - weeksOn);
  songRemaining = Math.min(songRemaining, remainingWeeks);
  if (songRemaining <= 0) return 0;

  let drift = Math.max(-8, Math.min(8, avgDrift));
  drift += (currentRank - 50) * 0.002;

  let totalPts = 0;
  let rank = currentRank;
  for (let week = 0; week < Math.floor(songRemaining); week++) {
    const damping = 1 / (1 + week * 0.15);
    rank += drift * damping;
    rank += week * 0.3;
    rank = Math.max(1, Math.min(100, rank));
    totalPts += Math.max(0, 101 - rank);
    if (rank >= 99.5) break;
  }

  return Math.round(totalPts * 10) / 10;
}

function handlePredict(year) {
  const trackingStart = `${year - 1}-11-15`;
  const trackingEnd = `${year}-11-15`;
  const latestDate = availableDates.length ? availableDates[0] : null;
  if (!latestDate) return json({ error: "No data available" }, 500);

  const totalWeeks = countSaturdays(trackingStart, trackingEnd);
  const elapsedWeeks = countSaturdays(trackingStart, latestDate);
  const remainingWeeks = totalWeeks - elapsedWeeks;

  // YTD actual points
  const ytdResults = computeRankings(trackingStart, latestDate, 99999).results;
  const ytdMap = {};
  for (const s of ytdResults) ytdMap[s.key] = s;

  // Current chart
  const currentChart = getChartAtDate(latestDate);

  // Project future points for songs on current chart
  const projections = {};
  for (const [key, currentRank] of Object.entries(currentChart)) {
    const entries = chartData[key] || [];
    const recent = entries
      .filter((e) => e.date >= trackingStart && e.date <= latestDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    projections[key] = projectFuturePoints(recent, currentRank, remainingWeeks);
  }

  // Merge
  const final = {};
  const allKeys = new Set([...Object.keys(ytdMap), ...Object.keys(projections)]);
  for (const key of allKeys) {
    const actual = ytdMap[key] ? ytdMap[key].points : 0;
    const projected = projections[key] || 0;
    const total = actual + projected;
    const [title, artist] = splitKey(key);
    const peak = ytdMap[key] ? ytdMap[key].peak_rank : (currentChart[key] || 999);
    const weeks = ytdMap[key] ? ytdMap[key].weeks_on : 0;

    final[key] = {
      key,
      title,
      artist,
      actual_pts: Math.round(actual * 10) / 10,
      projected_pts: Math.round(projected * 10) / 10,
      total_pts: Math.round(total * 10) / 10,
      peak_rank: peak,
      weeks_on: weeks,
      current_rank: currentChart[key] || null,
    };
  }

  const ranked = Object.entries(final)
    .sort((a, b) => b[1].total_pts - a[1].total_pts)
    .slice(0, 100);

  const predictions = ranked.map(([, info], i) => ({
    ...info,
    predicted_rank: i + 1,
  }));

  return json({
    year,
    tracking_start: trackingStart,
    tracking_end: trackingEnd,
    latest_date: latestDate,
    predictions,
  });
}

// ── Router ─────────────────────────────────────────────────────────────

function route(event) {
  // Normalize: strip leading slash then match
  const rawPath = event.path;
  const qp = event.queryStringParameters || {};

  // /api/current
  if (rawPath === "/api/current" || rawPath === "/api/current/") return handleCurrent();

  // /api/dates
  if (rawPath === "/api/dates" || rawPath === "/api/dates/") return handleDates();

  // /api/stats
  if (rawPath === "/api/stats" || rawPath === "/api/stats/") return handleStats();

  // /api/search
  if (rawPath === "/api/search" || rawPath === "/api/search/") return handleSearch(qp.q);

  // /api/check-update
  if (rawPath === "/api/check-update" || rawPath === "/api/check-update/") return handleCheckUpdate();

  // /api/year-end/years (must be before /api/year-end/:year)
  if (rawPath === "/api/year-end/years" || rawPath === "/api/year-end/years/") return handleYearEndYears();

  // /api/year-end/:year
  const yeMatch = rawPath.match(/^\/api\/year-end\/(\d{4})\/?$/);
  if (yeMatch) return handleYearEnd(parseInt(yeMatch[1]));

  // /api/song/:key (key can contain anything, including slashes)
  if (rawPath.startsWith("/api/song/")) {
    const songKey = rawPath.slice("/api/song/".length);
    if (songKey) return handleSong(songKey);
  }

  // /api/artist/:name
  if (rawPath.startsWith("/api/artist/")) {
    const artistName = rawPath.slice("/api/artist/".length);
    if (artistName) return handleArtist(artistName);
  }

  // /api/chart/:date
  const chartMatch = rawPath.match(/^\/api\/chart\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (chartMatch) return handleChartByDate(chartMatch[1]);

  // /api/rankings?start=&end=&limit=
  if (rawPath === "/api/rankings" || rawPath === "/api/rankings/") {
    return handleRankings(qp.start, qp.end, parseInt(qp.limit) || 100);
  }

  // /api/predict/:year
  const prMatch = rawPath.match(/^\/api\/predict\/(\d{4})\/?$/);
  if (prMatch) return handlePredict(parseInt(prMatch[1]));

  // /api/update — not supported on Netlify (needs scraper)
  if (rawPath === "/api/update" || rawPath === "/api/update/") {
    return json({ status: "error", message: "Update not available on Netlify. Run locally." }, 400);
  }

  return json({ error: "Not found" }, 404);
}

// ── Entry point ───────────────────────────────────────────────────────

export default async function handler(request) {
  try {
    loadData();
    const url = new URL(request.url);
    const event = {
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
    };
    return route(event);
  } catch (err) {
    return json({ error: err.message || "Internal error" }, 500);
  }
}
