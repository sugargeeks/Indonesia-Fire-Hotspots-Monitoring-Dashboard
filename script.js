/**
 * script.js — Indonesia Fire Hotspots Monitoring Dashboard
 * Analyst: Siti Nurlia Kilmas
 * Data source: NASA FIRMS (daily_province.csv) → hotspots.json
 *
 * Architecture:
 *  1. Load hotspots.json once on page load
 *  2. Store raw aggregations globally (DATA)
 *  3. Filters (province, year, satellite) derive a filtered view
 *  4. All KPIs, charts, and table are updated from the filtered view
 *  5. No page refresh needed — all updates are in-memory
 */

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let DATA = null;        // raw JSON loaded from hotspots.json
let FILTER = {          // active filter values
  province:  '',
  year:      '',
  satellite: ''
};
let TREND_MODE = 'monthly';   // 'monthly' | 'yearly'

/* Chart.js instances — stored so we can destroy+rebuild on filter */
const charts = {};

/* Chart.js global defaults for dark theme */
Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#1f2937';
Chart.defaults.font.family = '-apple-system,"Segoe UI",system-ui,sans-serif';
Chart.defaults.font.size = 11;

/* ============================================================
   COLOUR PALETTES
   ============================================================ */
const PALETTE = {
  fire:    ['#fb923c','#f97316','#ea580c','#dc2626','#b91c1c','#9b1c1c'],
  teal:    ['#29b8bd','#21969a','#1a7a7c','#155e5f','#0f3d3e'],
  amber:   ['#fbbf24','#f59e0b','#d97706','#b45309'],
  mixed:   ['#f97316','#fbbf24','#29b8bd','#a78bfa','#34d399','#f472b6',
             '#60a5fa','#fb923c','#4ade80','#c084fc','#38bdf8','#f87171',
             '#facc15','#86efac','#7dd3fc'],
  sat:     { snpp: '#f97316', noaa20: '#29b8bd' },
};

/* Month name helper */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ============================================================
   ENTRY POINT: Load data then initialise
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Show loading overlay (injected here so HTML stays clean)
  injectLoadingOverlay();

  fetch('hotspots.json')
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load hotspots.json: ${r.status}`);
      return r.json();
    })
    .then(json => {
      DATA = json;
      initFilters();
      renderAll();
      hideLoadingOverlay();
    })
    .catch(err => {
      console.error(err);
      hideLoadingOverlay();
      document.body.insertAdjacentHTML('afterbegin',
        `<div class="fixed top-4 left-1/2 -translate-x-1/2 bg-red-800 text-white px-6 py-3 rounded-xl z-50 shadow-lg">
           ⚠️ Could not load hotspots.json — ${err.message}
         </div>`);
    });
});

/* ============================================================
   LOADING OVERLAY
   ============================================================ */
function injectLoadingOverlay() {
  const el = document.createElement('div');
  el.id = 'loadingOverlay';
  el.innerHTML = `
    <div class="text-center">
      <div class="spinner mb-4"></div>
      <p class="text-gray-400 text-sm">Loading dashboard data…</p>
    </div>`;
  document.body.appendChild(el);
}

function hideLoadingOverlay() {
  const el = document.getElementById('loadingOverlay');
  if (el) {
    el.classList.add('hidden');
    setTimeout(() => el.remove(), 500);
  }
}

/* ============================================================
   FILTER INITIALISATION
   Populate selects with values from the loaded data
   ============================================================ */
function initFilters() {
  const provinces = DATA.byProvince.map(p => p.province).sort();
  const years     = DATA.byYear.map(y => y.year).sort();

  populateSelect('filterProvince', provinces, 'All Provinces');
  populateSelect('filterYear',     years,     'All Years');

  // Wire event listeners
  document.getElementById('filterProvince').addEventListener('change', onFilterChange);
  document.getElementById('filterYear').addEventListener('change', onFilterChange);
  document.getElementById('filterSatellite').addEventListener('change', onFilterChange);
  document.getElementById('btnReset').addEventListener('click', resetFilters);

  // Wire table header sort
  document.querySelectorAll('#rankingTable th.sortable').forEach(th => {
    th.addEventListener('click', () => onTableSort(th.dataset.col));
  });
}

function populateSelect(id, values, placeholder) {
  const sel = document.getElementById(id);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

/* ============================================================
   FILTER CHANGE HANDLER
   ============================================================ */
function onFilterChange() {
  FILTER.province  = document.getElementById('filterProvince').value;
  FILTER.year      = document.getElementById('filterYear').value;
  FILTER.satellite = document.getElementById('filterSatellite').value;
  renderAll();
}

function resetFilters() {
  FILTER = { province: '', year: '', satellite: '' };
  document.getElementById('filterProvince').value  = '';
  document.getElementById('filterYear').value      = '';
  document.getElementById('filterSatellite').value = '';
  renderAll();
}

/* ============================================================
   TREND MODE TOGGLE (called from HTML onclick)
   ============================================================ */
function setTrendMode(mode) {
  TREND_MODE = mode;
  document.querySelectorAll('.trend-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  renderTrendChart();
}

/* ============================================================
   DERIVED / FILTERED DATA HELPERS
   These derive filtered aggregations from DATA + FILTER
   ============================================================ */

/**
 * Returns province-level totals respecting active filters.
 * When year filter is active → use byProvinceYear
 * When no year filter     → use byProvince
 * Then apply province filter (single entry if set)
 */
function getFilteredByProvince() {
  let rows;

  if (FILTER.year) {
    // Filter byProvinceYear to the selected year
    rows = DATA.byProvinceYear
      .filter(r => r.year === FILTER.year)
      .map(r => ({
        province: r.province,
        total:    r.total,
        snpp:     r.snpp,
        noaa20:   r.noaa20,
        hc:       r.hc,
        frp:      r.frp,
      }));
  } else {
    // All years — use pre-aggregated byProvince
    rows = DATA.byProvince.map(r => ({ ...r }));
  }

  // Apply satellite filter
  if (FILTER.satellite === 'snpp') {
    rows = rows.map(r => ({ ...r, total: r.snpp }));
  } else if (FILTER.satellite === 'noaa20') {
    rows = rows.map(r => ({ ...r, total: r.noaa20 }));
  }

  // Apply province filter (keep only selected province)
  if (FILTER.province) {
    rows = rows.filter(r => r.province === FILTER.province);
  }

  // Sort descending by total
  return rows.sort((a, b) => b.total - a.total);
}

/**
 * Returns time-series data for the trend chart.
 * Mode = 'monthly' or 'yearly'
 * Province and Year filters are applied.
 */
function getFilteredTrend() {
  if (TREND_MODE === 'yearly') {
    // --- Yearly trend ---
    let rows;
    if (FILTER.province) {
      rows = DATA.byProvinceYear
        .filter(r => r.province === FILTER.province)
        .map(r => ({ label: r.year, total: r.total, snpp: r.snpp, noaa20: r.noaa20 }));
    } else {
      rows = DATA.byYear.map(r => ({ label: r.year, total: r.total, snpp: r.snpp, noaa20: r.noaa20 }));
    }
    // Apply year filter as highlight (don't remove, since we're showing all years)
    // Satellite filter
    if (FILTER.satellite === 'snpp') {
      rows = rows.map(r => ({ ...r, total: r.snpp }));
    } else if (FILTER.satellite === 'noaa20') {
      rows = rows.map(r => ({ ...r, total: r.noaa20 }));
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  // --- Monthly trend ---
  let rows;
  if (FILTER.province) {
    // Use byProvinceMonth for selected province
    rows = DATA.byProvinceMonth
      .filter(r => r.province === FILTER.province)
      .map(r => ({ label: r.month, total: r.total, snpp: r.snpp, noaa20: r.noaa20 }));
  } else {
    rows = DATA.byMonth.map(r => ({ label: r.month, total: r.total, snpp: r.snpp, noaa20: r.noaa20 }));
  }

  // Apply year filter
  if (FILTER.year) {
    rows = rows.filter(r => r.label.startsWith(FILTER.year));
  }

  // Satellite filter
  if (FILTER.satellite === 'snpp') {
    rows = rows.map(r => ({ ...r, total: r.snpp }));
  } else if (FILTER.satellite === 'noaa20') {
    rows = rows.map(r => ({ ...r, total: r.noaa20 }));
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Compute summary KPIs from filtered province data.
 */
function computeKPIs(filteredByProv) {
  const total  = filteredByProv.reduce((s, r) => s + r.total, 0);
  const frpSum = filteredByProv.reduce((s, r) => s + r.frp,   0);

  // Days in filtered time range
  let days = DATA.meta.totalDays;
  if (FILTER.year) {
    // Count distinct days in that year (approximate from byDate)
    days = DATA.byDate.filter(d => d.date.startsWith(FILTER.year)).length || 1;
  }

  const avg = days > 0 ? +(total / days).toFixed(2) : 0;
  const top = filteredByProv.length > 0 ? filteredByProv[0] : { province: '—', total: 0 };

  return { total, frpSum: +frpSum.toFixed(2), avg, top, days };
}

/* ============================================================
   RENDER ALL
   Master function — calls each sub-renderer
   ============================================================ */
function renderAll() {
  const filteredProv = getFilteredByProvince();
  const kpis         = computeKPIs(filteredProv);

  updateBanners();
  updateKPIs(kpis, filteredProv);
  renderTrendChart();
  renderPolarChart(filteredProv);
  renderTopProvincesChart(filteredProv);
  renderSatelliteChart(filteredProv);
  renderConfidenceChart(filteredProv);
  renderAnnualChart();
  renderSeasonalChart();
  renderTable(filteredProv);
}

/* ============================================================
   BANNER / META
   ============================================================ */
function updateBanners() {
  const { dateMin, dateMax, totalProvinces } = DATA.meta;
  const rangeText = `${dateMin} → ${dateMax}`;
  document.getElementById('dataDateRange').textContent   = `Data: ${rangeText}`;
  document.getElementById('footerDateRange').textContent = rangeText;
  document.getElementById('footerProvinces').textContent = `${totalProvinces} provinces`;
}

/* ============================================================
   KPI CARDS
   ============================================================ */
function updateKPIs(kpis, filteredProv) {
  // Format helpers
  const fmt  = n => n.toLocaleString('id-ID');
  const fmtF = n => n >= 1_000_000
    ? (n / 1_000_000).toFixed(2) + 'M'
    : n >= 1_000
      ? (n / 1_000).toFixed(1) + 'K'
      : n.toString();

  animateKPI('kpiTotal',   fmt(kpis.total));
  animateKPI('kpiAvg',     fmt(kpis.avg));
  animateKPI('kpiFRP',     fmtF(kpis.frpSum));
  animateKPI('kpiTopProv', kpis.top.province);

  document.getElementById('kpiTotalSub').textContent =
    FILTER.year ? `in ${FILTER.year}` : 'all time';
  document.getElementById('kpiAvgSub').textContent =
    `hotspots / day (${kpis.days.toLocaleString('id-ID')} days)`;
  document.getElementById('kpiTopProvSub').textContent =
    kpis.top.province !== '—' ? fmt(kpis.top.total) + ' hotspots' : '—';
}

function animateKPI(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('kpi-animate');
  void el.offsetWidth; // force reflow
  el.textContent = value;
  el.classList.add('kpi-animate');
}

/* ============================================================
   CHART HELPERS
   ============================================================ */
function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

function getCtx(id) {
  return document.getElementById(id).getContext('2d');
}

/* ============================================================
   CHART 1: Trend (Line) — Monthly or Yearly
   ============================================================ */
function renderTrendChart() {
  destroyChart('trend');
  const trend = getFilteredTrend();

  if (!trend.length) {
    destroyChart('trend');
    return;
  }

  // For monthly: format label as "Jan 2019" for readability
  const labels = trend.map(r => {
    if (TREND_MODE === 'monthly' && r.label.length === 7) {
      const [y, m] = r.label.split('-');
      return `${MONTH_NAMES[+m - 1]} '${y.slice(2)}`;
    }
    return r.label;
  });

  const values = trend.map(r => r.total);

  // Sample down if too many points (> 300) to keep chart fast
  const MAX_POINTS = 240;
  let sampledLabels = labels;
  let sampledValues = values;
  if (labels.length > MAX_POINTS) {
    const step = Math.ceil(labels.length / MAX_POINTS);
    sampledLabels = labels.filter((_, i) => i % step === 0);
    sampledValues = values.filter((_, i) => i % step === 0);
  }

  charts['trend'] = new Chart(getCtx('chartTrend'), {
    type: 'line',
    data: {
      labels: sampledLabels,
      datasets: [{
        label: 'Hotspots',
        data: sampledValues,
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.12)',
        borderWidth: 2,
        pointRadius: sampledLabels.length > 60 ? 0 : 2,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2937',
          titleColor: '#f3f4f6',
          bodyColor: '#d1d5db',
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toLocaleString('id-ID')} hotspots`
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#1f2937' },
          ticks: {
            maxRotation: 45,
            maxTicksLimit: 18,
            color: '#6b7280'
          }
        },
        y: {
          grid: { color: '#1f2937' },
          ticks: {
            color: '#6b7280',
            callback: v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v
          },
          beginAtZero: true,
        }
      }
    }
  });
}

/* ============================================================
   CHART 2: Polar Area — Province Share (Top 10)
   ============================================================ */
function renderPolarChart(filteredProv) {
  destroyChart('polar');
  const top10 = filteredProv.slice(0, 10);
  if (!top10.length) return;

  const labels = top10.map(r => r.province);
  const values = top10.map(r => r.total);

  charts['polar'] = new Chart(getCtx('chartPolar'), {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: PALETTE.mixed.map(c => c + 'bb'),
        borderColor:     PALETTE.mixed,
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 9 },
            color: '#9ca3af',
            boxWidth: 10,
            padding: 6,
          }
        },
        tooltip: {
          backgroundColor: '#1f2937',
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed.r.toLocaleString('id-ID')}`
          }
        }
      },
      scales: {
        r: {
          grid: { color: '#1f2937' },
          ticks: { display: false },
        }
      }
    }
  });
}

/* ============================================================
   CHART 3: Horizontal Bar — Top 10 Provinces
   ============================================================ */
function renderTopProvincesChart(filteredProv) {
  destroyChart('topProv');
  const top10 = filteredProv.slice(0, 10);
  if (!top10.length) return;

  const labels = top10.map(r => r.province).reverse();
  const values = top10.map(r => r.total).reverse();

  charts['topProv'] = new Chart(getCtx('chartTopProvinces'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Hotspots',
        data: values,
        backgroundColor: PALETTE.fire.map(c => c + 'cc'),
        borderColor: PALETTE.fire,
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2937',
          callbacks: {
            label: ctx => ` ${ctx.parsed.x.toLocaleString('id-ID')} hotspots`
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#1f2937' },
          ticks: { color: '#6b7280', callback: v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v },
          beginAtZero: true,
        },
        y: {
          grid: { display: false },
          ticks: { color: '#d1d5db', font: { size: 10 } }
        }
      }
    }
  });
}

/* ============================================================
   CHART 4: Satellite Comparison — Grouped Bar
   ============================================================ */
function renderSatelliteChart(filteredProv) {
  destroyChart('satellite');
  const top10 = filteredProv.slice(0, 10);
  if (!top10.length) return;

  const labels = top10.map(r => r.province);
  const snppData  = top10.map(r => r.snpp);
  const noaaData  = top10.map(r => r.noaa20);

  // If satellite filter is active, show only relevant data
  const datasets = [];
  if (FILTER.satellite !== 'noaa20') {
    datasets.push({
      label: 'SNPP / VIIRS',
      data: snppData,
      backgroundColor: PALETTE.sat.snpp + 'bb',
      borderColor: PALETTE.sat.snpp,
      borderWidth: 1,
      borderRadius: 4,
    });
  }
  if (FILTER.satellite !== 'snpp') {
    datasets.push({
      label: 'NOAA-20',
      data: noaaData,
      backgroundColor: PALETTE.sat.noaa20 + 'bb',
      borderColor: PALETTE.sat.noaa20,
      borderWidth: 1,
      borderRadius: 4,
    });
  }

  charts['satellite'] = new Chart(getCtx('chartSatellite'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#9ca3af', boxWidth: 12, font: { size: 10 } }
        },
        tooltip: {
          backgroundColor: '#1f2937',
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('id-ID')}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af', maxRotation: 45, font: { size: 9 } }
        },
        y: {
          grid: { color: '#1f2937' },
          ticks: { color: '#6b7280', callback: v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v },
          beginAtZero: true,
        }
      }
    }
  });
}

/* ============================================================
   CHART 5: Doughnut — High-Confidence vs Other (SNPP)
   ============================================================ */
function renderConfidenceChart(filteredProv) {
  destroyChart('confidence');

  const totalSNPP = filteredProv.reduce((s, r) => s + r.snpp,  0);
  const totalHC   = filteredProv.reduce((s, r) => s + r.hc,    0);
  const nomLow    = Math.max(0, totalSNPP - totalHC);
  const pct = totalSNPP > 0 ? ((totalHC / totalSNPP) * 100).toFixed(1) : 0;

  document.getElementById('confidenceNote').textContent =
    `${pct}% of SNPP detections are high-confidence`;

  charts['confidence'] = new Chart(getCtx('chartConfidence'), {
    type: 'doughnut',
    data: {
      labels: ['High Confidence', 'Nominal / Low'],
      datasets: [{
        data: [totalHC, nomLow],
        backgroundColor: ['#f97316bb', '#1a7a7cbb'],
        borderColor:     ['#f97316',   '#1a7a7c'],
        borderWidth: 2,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#9ca3af', boxWidth: 12, font: { size: 10 }, padding: 10 }
        },
        tooltip: {
          backgroundColor: '#1f2937',
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString('id-ID')}`
          }
        }
      }
    }
  });
}

/* ============================================================
   CHART 6: Annual Hotspots Bar
   Respects province & satellite filter but always shows all years
   ============================================================ */
function renderAnnualChart() {
  destroyChart('annual');

  let rows;
  if (FILTER.province) {
    rows = DATA.byProvinceYear.filter(r => r.province === FILTER.province);
  } else {
    rows = DATA.byYear;
  }
  rows = [...rows].sort((a, b) => (a.year || '').localeCompare(b.year || ''));

  const labels = rows.map(r => r.year);
  let values = rows.map(r => {
    if (FILTER.satellite === 'snpp')   return r.snpp;
    if (FILTER.satellite === 'noaa20') return r.noaa20;
    return r.total;
  });

  // Highlight the selected year if filter active
  const bgColors = labels.map(y => {
    if (FILTER.year && y === FILTER.year) return '#f97316';
    return '#29b8bdaa';
  });

  charts['annual'] = new Chart(getCtx('chartAnnual'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Hotspots',
        data: values,
        backgroundColor: bgColors,
        borderColor: '#29b8bd',
        borderWidth: 1,
        borderRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2937',
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toLocaleString('id-ID')} hotspots`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af' } },
        y: {
          grid: { color: '#1f2937' },
          ticks: { color: '#6b7280', callback: v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v },
          beginAtZero: true,
        }
      }
    }
  });
}

/* ============================================================
   CHART 7: Monthly Seasonality (avg hotspots by calendar month)
   Shows average hotspot count for each calendar month (Jan–Dec)
   across all years in the filtered dataset
   ============================================================ */
function renderSeasonalChart() {
  destroyChart('seasonal');

  // Choose source depending on province filter
  let rows;
  if (FILTER.province) {
    rows = DATA.byProvinceMonth.filter(r => r.province === FILTER.province);
  } else {
    rows = DATA.byMonth;
  }

  // Apply year filter
  if (FILTER.year) {
    rows = rows.filter(r => r.month.startsWith(FILTER.year));
  }

  // Apply satellite filter to get the correct value field
  const valField = FILTER.satellite === 'snpp'
    ? 'snpp'
    : FILTER.satellite === 'noaa20'
      ? 'noaa20'
      : 'total';

  // Accumulate by calendar month (1–12)
  const monthSums   = new Array(12).fill(0);
  const monthCounts = new Array(12).fill(0);
  rows.forEach(r => {
    const mIdx = parseInt(r.month.split('-')[1], 10) - 1;
    monthSums[mIdx]   += r[valField];
    monthCounts[mIdx] += 1;
  });

  const avgs = monthSums.map((s, i) => monthCounts[i] > 0 ? +(s / monthCounts[i]).toFixed(0) : 0);

  // Fire season colour: months Jun–Oct are peak in Indonesia
  const bgColors = avgs.map((_, i) =>
    (i >= 5 && i <= 9) ? '#ea580ccc' : '#fbbf24aa'
  );

  charts['seasonal'] = new Chart(getCtx('chartSeasonal'), {
    type: 'bar',
    data: {
      labels: MONTH_NAMES,
      datasets: [{
        label: 'Avg Hotspots',
        data: avgs,
        backgroundColor: bgColors,
        borderColor: '#d97706',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2937',
          callbacks: {
            label: ctx => ` Avg ${ctx.parsed.y.toLocaleString('id-ID')} hotspots`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af' } },
        y: {
          grid: { color: '#1f2937' },
          ticks: { color: '#6b7280', callback: v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v },
          beginAtZero: true,
        }
      }
    }
  });
}

/* ============================================================
   TABLE: Province Rankings
   ============================================================ */
let TABLE_SORT = { col: 'total', dir: 'desc' };

function onTableSort(col) {
  if (TABLE_SORT.col === col) {
    TABLE_SORT.dir = TABLE_SORT.dir === 'desc' ? 'asc' : 'desc';
  } else {
    TABLE_SORT = { col, dir: col === 'province' ? 'asc' : 'desc' };
  }

  // Update header indicators
  document.querySelectorAll('#rankingTable th.sortable').forEach(th => {
    const isActive = th.dataset.col === TABLE_SORT.col;
    const arrow = isActive ? (TABLE_SORT.dir === 'desc' ? ' ↓' : ' ↑') : ' ↕';
    th.textContent = th.textContent.replace(/ [↓↑↕]$/, '') + arrow;
  });

  renderAll();
}

function renderTable(filteredProv) {
  // Sort
  const { col, dir } = TABLE_SORT;
  const sorted = [...filteredProv].sort((a, b) => {
    const va = a[col], vb = b[col];
    if (typeof va === 'string') return dir === 'asc'
      ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === 'asc' ? va - vb : vb - va;
  });

  const maxTotal = sorted.length > 0 ? sorted.reduce((m, r) => Math.max(m, r.total), 0) : 1;
  const tbody = document.getElementById('rankingTableBody');
  tbody.innerHTML = '';

  sorted.forEach((row, idx) => {
    const pct = maxTotal > 0 ? Math.round((row.total / maxTotal) * 100) : 0;
    const frpFmt = row.frp >= 1_000_000
      ? (row.frp / 1_000_000).toFixed(2) + 'M'
      : row.frp >= 1_000
        ? (row.frp / 1_000).toFixed(1) + 'K'
        : row.frp.toFixed(0);

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-teal-900/20 transition-colors';
    tr.innerHTML = `
      <td class="py-2 pr-3 text-gray-500 text-xs">${idx + 1}</td>
      <td class="py-2 pr-4 font-medium text-gray-200">${row.province}</td>
      <td class="py-2 pr-4 text-right">
        <div class="rank-bar-wrap justify-end">
          <span class="text-fire-400 font-semibold">${row.total.toLocaleString('id-ID')}</span>
          <div class="rank-bar" style="width:${pct}px;max-width:80px;"></div>
        </div>
      </td>
      <td class="py-2 pr-4 text-right text-amber-300">${row.snpp.toLocaleString('id-ID')}</td>
      <td class="py-2 pr-4 text-right text-teal-400">${row.noaa20.toLocaleString('id-ID')}</td>
      <td class="py-2 pr-4 text-right text-gray-400">${row.hc.toLocaleString('id-ID')}</td>
      <td class="py-2 text-right text-orange-400">${frpFmt}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tableCount').textContent =
    `Showing ${sorted.length} of ${DATA.byProvince.length} provinces`;
}
