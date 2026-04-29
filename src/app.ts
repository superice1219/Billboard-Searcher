// Chart.js loaded via CDN in index.html
interface ChartInstance {
  destroy(): void;
}

declare const Chart: {
  new (ctx: CanvasRenderingContext2D, config: Record<string, unknown>): ChartInstance;
};

// ---- Response types ----

interface ChartEntry {
  date: string;
  rank: number;
  weeks: number;
}

interface SongResult {
  key: string;
  rank: number;
  title: string;
  artist: string;
  weeks: number;
  peak_rank?: number | null;
  total_weeks?: number;
  latest_rank?: number | null;
  latest_date?: string;
  first_date?: string;
  points?: number;
  weeks_on?: number;
  best_week?: string;
  peak?: number | null;
  peak_weeks?: number | null;
  actual_pts?: number;
  projected_pts?: number;
  total_pts?: number;
  predicted_rank?: number;
  current_rank?: number | null;
}

interface SongDetail {
  key: string;
  title: string;
  artist: string;
  peak_rank: number;
  peak_weeks: number;
  total_weeks: number;
  first_date: string;
  latest_date: string;
  chart_run: ChartEntry[];
}

interface ArtistData {
  artist: string;
  total_songs: number;
  number_ones: number;
  top10_hits: number;
  songs: SongResult[];
}

interface StatsData {
  total_songs: number;
  total_weeks: number;
  date_range: [string | null, string | null];
}

interface UpdateCheck {
  data_latest: string;
  online_latest: string;
  outdated: boolean;
  missing_weeks: number;
}

// ---- App State ----

interface AppState {
  currentView: string;
  currentSong: string | null;
  trendChart: ChartInstance | null;
}

const state: AppState = {
  currentView: "chart",
  currentSong: null,
  trendChart: null,
};

// ---- Init ----

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLElement>(".artist-link");
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      loadArtist(link.dataset.artist!);
    }
  });

  setupNav();
  setupSearch();
  setupUpdateButton();
  loadStats();
  loadYearEndYears();
  setupPredict();

  loadCurrentChart();
  loadDates();
  autoUpdateCheck();
  setupPredict();
});

// ---- Navigation ----

function setupNav(): void {
  document.querySelectorAll<HTMLButtonElement>(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      switchView(btn.dataset.view!);
    });
  });
  document.getElementById("btn-back")!.addEventListener("click", () => {
    switchView("chart");
  });
  document.getElementById("btn-back-artist")!.addEventListener("click", () => {
    switchView("chart");
  });
}

function switchView(view: string): void {
  state.currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));

  if (view === "song") {
    document.getElementById("view-song")!.classList.add("active");
  } else if (view === "artist") {
    document.getElementById("view-artist")!.classList.add("active");
    document.querySelector<HTMLButtonElement>('.nav-btn[data-view="artist"]')!.classList.add("active");
  } else if (view === "search") {
    document.getElementById("view-search")!.classList.add("active");
    document.querySelector<HTMLButtonElement>('.nav-btn[data-view="search"]')!.classList.add("active");
  } else if (view === "year-end") {
    document.getElementById("view-year-end")!.classList.add("active");
    document.querySelector<HTMLButtonElement>('.nav-btn[data-view="year-end"]')!.classList.add("active");
    loadYearEndChart();
  } else if (view === "ranking") {
    document.getElementById("view-ranking")!.classList.add("active");
    document.querySelector<HTMLButtonElement>('.nav-btn[data-view="ranking"]')!.classList.add("active");
    initRankingView();
  } else if (view === "predict") {
    document.getElementById("view-predict")!.classList.add("active");
    document.querySelector<HTMLButtonElement>('.nav-btn[data-view="predict"]')!.classList.add("active");
  } else {
    document.getElementById("view-chart")!.classList.add("active");
    document.querySelector<HTMLButtonElement>('.nav-btn[data-view="chart"]')!.classList.add("active");
  }
}

// ---- Current Chart ----

async function loadCurrentChart(date: string | null = null): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>("#chart-table tbody")!;
  const loading = document.getElementById("chart-loading")!;
  tbody.innerHTML = "";
  loading.classList.remove("hidden");

  let url = "/api/current";
  if (date) url = `/api/chart/${date}`;

  try {
    const resp = await fetch(url);
    const songs: SongResult[] = await resp.json();

    document.getElementById("chart-date")!.textContent =
      date || (songs.length > 0 ? String(songs[0].rank) : "");

    songs.forEach((s) => {
      const tr = document.createElement("tr");
      const rankClass = s.rank <= 3 ? ` rank-${s.rank}` : "";
      tr.innerHTML = `
        <td class="col-rank"><span class="rank-number${rankClass}">${s.rank}</span></td>
        <td class="song-title-col">${escHtml(s.title)}</td>
        <td class="song-artist-col">${artistLink(s.artist)}</td>
        <td class="col-weeks">${s.weeks}</td>
        <td class="col-action">
          <button class="btn-detail" data-key="${escHtml(s.key)}">走势</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("chart-count")!.textContent =
      songs.length > 0 ? `${songs.length} 首` : "";

    tbody.querySelectorAll<HTMLButtonElement>(".btn-detail").forEach((btn) => {
      btn.addEventListener("click", () => loadSong(btn.dataset.key!));
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">加载失败</td></tr>';
  }
  loading.classList.add("hidden");
}

// ---- Dates ----

async function loadDates(): Promise<void> {
  try {
    const resp = await fetch("/api/dates");
    const dates: string[] = await resp.json();
    const sel = document.getElementById("date-selector") as HTMLSelectElement;
    sel.innerHTML = '<option value="">最新</option>';
    dates.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      loadCurrentChart(sel.value || null);
    });
  } catch {
    console.error("Failed to load dates");
  }
}

// ---- Search ----

let searchTimeout: ReturnType<typeof setTimeout>;

function setupSearch(): void {
  const input = document.getElementById("search-input") as HTMLInputElement;
  const results = document.getElementById("search-results")!;

  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 1) {
      results.classList.remove("visible");
      document.getElementById("search-empty")!.style.display = "block";
      return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 250);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 1) {
      results.classList.add("visible");
      document.getElementById("search-empty")!.style.display = "none";
    }
  });

  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".search-box")) {
      results.classList.remove("visible");
    }
  });
}

async function doSearch(q: string): Promise<void> {
  const results = document.getElementById("search-results")!;
  const empty = document.getElementById("search-empty")!;
  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const songs: SongResult[] = await resp.json();
    if (songs.length === 0) {
      results.innerHTML =
        '<div class="search-result-item" style="color:var(--text-dim)">无结果</div>';
      empty.style.display = "none";
    } else {
      results.innerHTML = songs
        .map(
          (s) => `
        <div class="search-result-item" data-key="${escHtml(s.key)}">
          <div>
            <div class="search-result-title">${escHtml(s.title)}</div>
            <div class="search-result-artist">${artistLink(s.artist)}</div>
          </div>
          <div class="search-result-meta">
            最高 #${s.peak_rank} &middot; ${s.total_weeks} 周
          </div>
        </div>
      `
        )
        .join("");
      empty.style.display = "none";
    }
    results.classList.add("visible");

    results.querySelectorAll<HTMLElement>(".search-result-item[data-key]").forEach((item) => {
      item.addEventListener("click", () => {
        results.classList.remove("visible");
        (document.getElementById("search-input") as HTMLInputElement).value = "";
        loadSong(item.dataset.key!);
      });
    });
  } catch {
    results.innerHTML =
      '<div class="search-result-item" style="color:var(--red)">搜索失败</div>';
    results.classList.add("visible");
  }
}

// ---- Song Detail ----

async function loadSong(key: string): Promise<void> {
  state.currentSong = key;
  const songBtn = document.querySelector<HTMLButtonElement>('.nav-btn[data-view="song"]')!;
  songBtn.disabled = false;
  switchView("song");
  songBtn.classList.add("active");
  document.getElementById("btn-back")!.textContent = "← 返回";

  try {
    const resp = await fetch(`/api/song/${encodeURIComponent(key)}`);
    if (!resp.ok) throw new Error("Not found");
    const song: SongDetail = await resp.json();

    document.getElementById("song-title")!.textContent = song.title;
    document.getElementById("song-artist")!.innerHTML = artistLink(song.artist);

    document.getElementById("song-stats")!.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">#${song.peak_rank}</div>
        <div class="stat-label">最高排名</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${song.peak_weeks}</div>
        <div class="stat-label">Peak持续</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${song.total_weeks}</div>
        <div class="stat-label">在榜周数</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${song.first_date}</div>
        <div class="stat-label">首次入榜</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${song.latest_date}</div>
        <div class="stat-label">最近入榜</div>
      </div>
    `;

    drawTrend(song);

    const tbody = document.querySelector<HTMLTableSectionElement>("#history-table tbody")!;
    tbody.innerHTML = "";
    const reversed = [...song.chart_run].reverse();
    reversed.forEach((e) => {
      const tr = document.createElement("tr");
      const rankClass = e.rank <= 3 ? ` rank-${e.rank}` : "";
      tr.innerHTML = `
        <td>${e.date}</td>
        <td><span class="rank-number${rankClass}">${e.rank}</span></td>
        <td>${e.weeks}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch {
    document.getElementById("song-title")!.textContent = "歌曲未找到";
    document.getElementById("song-artist")!.textContent = "";
  }
}

function drawTrend(song: SongDetail): void {
  const canvas = document.getElementById("trend-chart") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  if (state.trendChart) state.trendChart.destroy();

  const labels = song.chart_run.map((e) => e.date);
  const ranks = song.chart_run.map((e) => e.rank);

  state.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "排名",
          data: ranks,
          borderColor: "#1db954",
          backgroundColor: "rgba(29, 185, 84, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: ranks.length > 100 ? 0 : 2,
          pointHitRadius: 8,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: { parsed: { y: number } }) => `排名: #${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        y: {
          reverse: true,
          min: 1,
          max: 100,
          ticks: {
            color: "#888",
            callback: (v: number) => (v === 1 ? "#1" : v % 20 === 0 ? v : ""),
          },
          grid: { color: "#222" },
          title: { display: true, text: "排名", color: "#888" },
        },
        x: {
          ticks: {
            color: "#888",
            maxTicksLimit: 15,
            maxRotation: 45,
          },
          grid: { display: false },
        },
      },
    },
  });
}

// ---- Update ----

function setupUpdateButton(): void {
  const btn = document.getElementById("btn-update") as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    btn.textContent = "更新中...";
    btn.disabled = true;
    try {
      const resp = await fetch("/api/update", { method: "POST" });
      const data: { status: string; message?: string } = await resp.json();
      if (data.status === "ok") {
        btn.textContent = "已触发更新";
        setTimeout(() => {
          btn.textContent = "更新数据";
          btn.disabled = false;
          loadCurrentChart();
          loadDates();
          loadStats();
        }, 3000);
      } else {
        btn.textContent = data.message || "更新失败";
        btn.disabled = false;
      }
    } catch {
      btn.textContent = "更新失败";
      btn.disabled = false;
    }
  });
}

// ---- Auto Update Check ----

async function autoUpdateCheck(): Promise<void> {
  try {
    const checkResp = await fetch("/api/check-update");
    const info: UpdateCheck = await checkResp.json();
    if (!info.outdated) return;

    const banner = document.getElementById("update-banner")!;
    const weeks = info.missing_weeks;

    banner.className = "update-banner updating";
    banner.textContent = `检测到 ${weeks} 周新数据，正在自动更新...`;
    banner.classList.remove("hidden");

    const updateResp = await fetch("/api/update", { method: "POST" });
    const updateResult: { status: string } = await updateResp.json();

    if (updateResult.status === "ok") {
      let attempts = 0;
      while (attempts < 30) {
        await sleep(2000);
        const pollResp = await fetch("/api/check-update");
        const pollResult: UpdateCheck = await pollResp.json();
        if (!pollResult.outdated) {
          banner.className = "update-banner done";
          banner.textContent = "数据已更新到最新！";
          setTimeout(() => banner.classList.add("hidden"), 2500);
          loadCurrentChart();
          loadDates();
          loadStats();
          return;
        }
        attempts++;
      }
    }
    banner.classList.add("hidden");
  } catch {
    console.error("Auto-update check failed");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Stats ----

async function loadStats(): Promise<void> {
  try {
    const resp = await fetch("/api/stats");
    const stats: StatsData = await resp.json();
    if (stats.date_range[0] && stats.date_range[1]) {
      document.getElementById("data-range")!.textContent =
        `${stats.date_range[0]} ~ ${stats.date_range[1]} · ${stats.total_songs} 首歌曲`;
    }
  } catch {
    /* ignore */
  }
}

// ---- Year-End Chart ----

async function loadYearEndYears(): Promise<void> {
  try {
    const resp = await fetch("/api/year-end/years");
    const years: number[] = await resp.json();
    const sel = document.getElementById("ye-year-selector") as HTMLSelectElement;
    years.forEach((y) => {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    });
    sel.value = String(years[0] || "");
    sel.addEventListener("change", () =>
      loadYearEndChart(Number(sel.value))
    );
  } catch {
    console.error("Failed to load year-end years");
  }
}

async function loadYearEndChart(year: number | null = null): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>("#ye-table tbody")!;
  const loading = document.getElementById("ye-loading")!;
  tbody.innerHTML = "";
  loading.classList.remove("hidden");

  if (!year) {
    const sel = document.getElementById("ye-year-selector") as HTMLSelectElement;
    year = Number(sel.value);
  }
  if (!year) {
    loading.classList.add("hidden");
    return;
  }

  try {
    const resp = await fetch(`/api/year-end/${year}`);
    if (!resp.ok) throw new Error("Not found");
    const songs: SongResult[] = await resp.json();

    document.getElementById("ye-year-label")!.textContent = `${year} 年度榜单`;
    document.getElementById("ye-count")!.textContent = `${songs.length} 首`;

    songs.forEach((s) => {
      const tr = document.createElement("tr");
      const rankClass = s.rank <= 3 ? ` rank-${s.rank}` : "";
      tr.innerHTML = `
        <td class="col-rank"><span class="rank-number${rankClass}">${s.rank}</span></td>
        <td class="song-title-col">${escHtml(s.title)}</td>
        <td class="song-artist-col">${artistLink(s.artist)}</td>
        <td class="col-weeks">${s.peak ? "#" + s.peak : "-"}</td>
        <td class="col-weeks">${s.peak_weeks ?? "-"}</td>
        <td class="col-weeks">${s.weeks || "-"}</td>
        <td class="col-action">
          <button class="btn-detail" data-key="${escHtml(s.key)}">走势</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll<HTMLButtonElement>(".btn-detail").forEach((btn) => {
      btn.addEventListener("click", () => loadSong(btn.dataset.key!));
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">加载失败</td></tr>';
  }
  loading.classList.add("hidden");
}

// ---- Custom Span Ranking ----

function initRankingView(): void {
  // Default: last 3 months
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);

  (document.getElementById("rk-start") as HTMLInputElement).value = toDateStr(start);
  (document.getElementById("rk-end") as HTMLInputElement).value = toDateStr(end);

  document.getElementById("rk-go")!.addEventListener("click", () => {
    const s = (document.getElementById("rk-start") as HTMLInputElement).value;
    const e = (document.getElementById("rk-end") as HTMLInputElement).value;
    document.getElementById("rk-label")!.textContent = `${s} ~ ${e}`;
    loadSpanRanking();
  });

  // 即时年榜: Billboard tracking period (Nov 15 of previous year) to today
  document.getElementById("rk-ytd")!.addEventListener("click", () => {
    const today = new Date();
    document.getElementById("rk-label")!.textContent = "即时年榜";
    (document.getElementById("rk-start") as HTMLInputElement).value = `${today.getFullYear() - 1}-11-15`;
    (document.getElementById("rk-end") as HTMLInputElement).value = toDateStr(today);
    loadSpanRanking();
  });

  // 即时十年榜: current decade start to today
  document.getElementById("rk-decade")!.addEventListener("click", () => {
    const today = new Date();
    document.getElementById("rk-label")!.textContent = "即时十年榜";
    (document.getElementById("rk-start") as HTMLInputElement).value = `${Math.floor(today.getFullYear() / 10) * 10}-01-01`;
    (document.getElementById("rk-end") as HTMLInputElement).value = toDateStr(today);
    loadSpanRanking();
  });
}

async function loadSpanRanking(): Promise<void> {
  const start = (document.getElementById("rk-start") as HTMLInputElement).value;
  const end = (document.getElementById("rk-end") as HTMLInputElement).value;
  if (!start || !end) return;

  const tbody = document.querySelector<HTMLTableSectionElement>("#rk-table tbody")!;
  const loading = document.getElementById("rk-loading")!;
  const empty = document.getElementById("rk-empty")!;
  tbody.innerHTML = "";
  empty.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const resp = await fetch(`/api/rankings?start=${start}&end=${end}&limit=100`);
    const data: { start: string; end: string; results: SongResult[] } = await resp.json();

    document.getElementById("rk-count")!.textContent = `${data.results.length} 首`;

    data.results.forEach((s, i) => {
      const tr = document.createElement("tr");
      const rankClass = i + 1 <= 3 ? ` rank-${i + 1}` : "";
      tr.innerHTML = `
        <td class="col-rank"><span class="rank-number${rankClass}">${i + 1}</span></td>
        <td class="song-title-col">${escHtml(s.title)}</td>
        <td class="song-artist-col">${artistLink(s.artist)}</td>
        <td class="col-weeks">${s.points!.toFixed(1)}</td>
        <td class="col-weeks">${s.weeks_on}</td>
        <td class="col-weeks">${s.peak_rank ? "#" + s.peak_rank : "-"}</td>
        <td class="col-action">
          <button class="btn-detail" data-key="${escHtml(s.key)}">走势</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll<HTMLButtonElement>(".btn-detail").forEach((btn) => {
      btn.addEventListener("click", () => loadSong(btn.dataset.key!));
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">加载失败</td></tr>';
  }
  loading.classList.add("hidden");
}

// ---- Year-End Prediction ----

function setupPredict(): void {
  document.getElementById("pr-go")!.addEventListener("click", loadPrediction);
}

async function loadPrediction(): Promise<void> {
  const year = (document.getElementById("pr-year-selector") as HTMLSelectElement).value;
  const tbody = document.querySelector<HTMLTableSectionElement>("#pr-table tbody")!;
  const loading = document.getElementById("pr-loading")!;
  const empty = document.getElementById("pr-empty")!;
  tbody.innerHTML = "";
  empty.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const resp = await fetch(`/api/predict/${year}`);
    const data: {
      year: number;
      tracking_start: string;
      tracking_end: string;
      latest_date: string;
      predictions: SongResult[];
    } = await resp.json();

    document.getElementById("pr-label")!.textContent = `${data.year} 年度预测`;
    document.getElementById("pr-desc")!.textContent =
      `追踪期: ${data.tracking_start} ~ ${data.tracking_end} | 最新数据: ${data.latest_date}`;

    data.predictions.forEach((s) => {
      const tr = document.createElement("tr");
      const rankClass = s.predicted_rank! <= 3 ? ` rank-${s.predicted_rank}` : "";
      tr.innerHTML = `
        <td class="col-rank"><span class="rank-number${rankClass}">${s.predicted_rank}</span></td>
        <td class="song-title-col">${escHtml(s.title)}</td>
        <td class="song-artist-col">${artistLink(s.artist)}</td>
        <td class="col-weeks">${s.actual_pts!.toFixed(1)}</td>
        <td class="col-weeks">${s.projected_pts!.toFixed(1)}</td>
        <td class="col-weeks">${s.total_pts!.toFixed(1)}</td>
        <td class="col-action">
          <button class="btn-detail" data-key="${escHtml(s.key)}">走势</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll<HTMLButtonElement>(".btn-detail").forEach((btn) => {
      btn.addEventListener("click", () => loadSong(btn.dataset.key!));
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">加载失败</td></tr>';
  }
  loading.classList.add("hidden");
}

// ---- Artist Detail ----

function artistLink(artist: string): string {
  const safe = escHtml(artist);
  return `<span class="artist-link" data-artist="${safe}">${safe}</span>`;
}

async function loadArtist(artistName: string): Promise<void> {
  const artistBtn = document.querySelector<HTMLButtonElement>('.nav-btn[data-view="artist"]')!;
  artistBtn.disabled = false;
  switchView("artist");
  artistBtn.classList.add("active");

  const loading = document.getElementById("artist-loading")!;
  const tbody = document.querySelector<HTMLTableSectionElement>("#artist-table tbody")!;
  tbody.innerHTML = "";
  loading.classList.remove("hidden");

  try {
    const resp = await fetch(`/api/artist/${encodeURIComponent(artistName)}`);
    if (!resp.ok) throw new Error("Not found");
    const data: ArtistData = await resp.json();

    document.getElementById("artist-name")!.textContent = data.artist;
    document.getElementById("artist-stats-text")!.textContent =
      `${data.total_songs} 首上榜歌曲 · ${data.number_ones} 首冠军单曲 · ${data.top10_hits} 首 Top 10`;

    document.getElementById("artist-stats")!.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${data.total_songs}</div>
        <div class="stat-label">上榜歌曲</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${data.number_ones}</div>
        <div class="stat-label">冠军单曲</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${data.top10_hits}</div>
        <div class="stat-label">Top 10</div>
      </div>
    `;

    data.songs.forEach((s) => {
      const tr = document.createElement("tr");
      const peakClass = s.peak_rank! <= 3 ? ` rank-${s.peak_rank}` : "";
      tr.innerHTML = `
        <td class="col-rank"><span class="rank-number${peakClass}">${s.peak_rank}</span></td>
        <td class="song-title-col">${escHtml(s.title)}</td>
        <td class="col-weeks">${s.total_weeks}</td>
        <td class="col-weeks">${s.first_date}</td>
        <td class="col-weeks">#${s.latest_rank}</td>
        <td class="col-action">
          <button class="btn-detail" data-key="${escHtml(s.key)}">走势</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll<HTMLButtonElement>(".btn-detail").forEach((btn) => {
      btn.addEventListener("click", () => loadSong(btn.dataset.key!));
    });
  } catch {
    document.getElementById("artist-name")!.textContent = "艺术家未找到";
    document.getElementById("artist-stats-text")!.textContent = "";
  }
  loading.classList.add("hidden");
}

// ---- Utility Helpers ----

function escHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}
