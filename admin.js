const SUPABASE_URL = 'https://mbflfmgwhlytcpkrooww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UlZ7_KXAiIJ3i7i2ln3vhA_COsIP6VR';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LISBON_AREAS = [
  { name: 'Baixa / Chiado',      lat: 38.7100, lng: -9.1395 },
  { name: 'Alfama',              lat: 38.7133, lng: -9.1308 },
  { name: 'Bairro Alto',         lat: 38.7115, lng: -9.1458 },
  { name: 'Príncipe Real',       lat: 38.7155, lng: -9.1487 },
  { name: 'Mouraria',            lat: 38.7160, lng: -9.1345 },
  { name: 'Intendente / Anjos',  lat: 38.7220, lng: -9.1360 },
  { name: 'Cais do Sodré',       lat: 38.7063, lng: -9.1452 },
  { name: 'Alcântara',           lat: 38.7047, lng: -9.1676 },
  { name: 'Santos / Estrela',    lat: 38.7075, lng: -9.1535 },
  { name: 'Belém',               lat: 38.6977, lng: -9.2059 },
  { name: 'Avenidas Novas',      lat: 38.7310, lng: -9.1490 },
  { name: 'Parque das Nações',   lat: 38.7652, lng: -9.0949 },
  { name: 'Campo de Ourique',    lat: 38.7132, lng: -9.1605 },
];

let placesService = null;

// ── Google Maps callback ──
function adminMapReady() {
  const map = new google.maps.Map(document.createElement('div'), {
    center: { lat: 38.7169, lng: -9.1399 }, zoom: 13,
  });
  placesService = new google.maps.places.PlacesService(map);
  log('INFO', 'Google Maps & Places API ready');
}

// ── Logging system ──
const logs = [];

function log(level, message, detail = null) {
  const entry = {
    level,
    message,
    detail,
    time: new Date(),
  };
  logs.push(entry);
  renderLog(entry);
  updateLogCount();
}

function renderLog(entry) {
  const win = document.getElementById('log-window');

  // Remove empty placeholder
  const empty = win.querySelector('.log-empty');
  if (empty) empty.remove();

  const time = entry.time.toLocaleTimeString('en-GB', { hour12: false });
  const ms   = String(entry.time.getMilliseconds()).padStart(3, '0');

  const row = document.createElement('div');
  row.className = `log-row log-${entry.level.toLowerCase()}`;
  row.innerHTML = `
    <span class="log-time">${time}.${ms}</span>
    <span class="log-level">${entry.level}</span>
    <span class="log-msg">${entry.message}</span>
    ${entry.detail ? `<span class="log-detail">${entry.detail}</span>` : ''}`;
  win.appendChild(row);
  win.scrollTop = win.scrollHeight;
}

function updateLogCount() {
  const counts = logs.reduce((acc, l) => {
    acc[l.level] = (acc[l.level] || 0) + 1; return acc;
  }, {});
  document.getElementById('log-count').textContent =
    `${logs.length} entries · ${counts.ERROR || 0} errors · ${counts.WARN || 0} warnings`;
}

document.getElementById('log-clear').addEventListener('click', () => {
  logs.length = 0;
  document.getElementById('log-window').innerHTML =
    '<div class="log-empty">Logs cleared.</div>';
  updateLogCount();
});

document.getElementById('log-copy').addEventListener('click', () => {
  const text = logs.map(l => {
    const t = l.time.toISOString();
    return `[${t}] [${l.level}] ${l.message}${l.detail ? ' — ' + l.detail : ''}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('log-copy');
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy', 2000);
  });
});

// ── Init ──
async function init() {
  log('INFO', 'Admin panel initialised');
  log('INFO', 'Loading stats and settings from Supabase…');
  await Promise.all([loadStats(), loadSettings(), loadDashboard()]);
  buildAreasGrid();
}

// ── Dashboard ──
const RATING_BANDS = [
  { label: '1.0 – 2.9', min: 1.0, max: 2.9, color: '#f87171' },
  { label: '3.0 – 3.9', min: 3.0, max: 3.9, color: '#fbbf24' },
  { label: '4.0 – 4.4', min: 4.0, max: 4.4, color: '#34d399' },
  { label: '4.5 – 5.0', min: 4.5, max: 5.0, color: '#10b981' },
];

async function loadDashboard() {
  log('INFO', 'Loading dashboard data');
  const { data, error } = await db.from('places').select('rating, place_type');

  if (error) {
    log('ERROR', 'Failed to load dashboard data', error.message);
    document.getElementById('dashboard-body').innerHTML =
      '<p class="dash-error">Failed to load data.</p>';
    return;
  }

  if (!data || data.length === 0) {
    document.getElementById('dashboard-body').innerHTML =
      '<p class="dash-error">No places in database yet. Run a fetch first.</p>';
    return;
  }

  const restaurants  = data.filter(p => p.place_type === 'restaurant');
  const cafes        = data.filter(p => p.place_type === 'cafe');

  function bandCounts(places) {
    return RATING_BANDS.map(b => ({
      ...b,
      count: places.filter(p => p.rating >= b.min && p.rating <= b.max).length,
    }));
  }

  const restBands = bandCounts(restaurants);
  const cafeBands = bandCounts(cafes);
  const maxCount  = Math.max(...restBands.map(b => b.count), ...cafeBands.map(b => b.count), 1);

  function avgRating(places) {
    if (!places.length) return '—';
    return (places.reduce((s, p) => s + (p.rating || 0), 0) / places.length).toFixed(2);
  }

  function renderChart(bands, total) {
    return bands.map(b => {
      const pct     = total ? ((b.count / total) * 100).toFixed(1) : 0;
      const barPct  = maxCount ? ((b.count / maxCount) * 100).toFixed(1) : 0;
      return `
        <div class="dash-row">
          <div class="dash-label">${b.label}</div>
          <div class="dash-bar-wrap">
            <div class="dash-bar" style="width:${barPct}%;background:${b.color}">
              ${b.count > 0 ? `<span class="dash-bar-count">${b.count}</span>` : ''}
            </div>
          </div>
          <div class="dash-pct">${pct}%</div>
        </div>`;
    }).join('');
  }

  log('SUCCESS', 'Dashboard data loaded',
    `${restaurants.length} restaurants, ${cafes.length} cafes`);

  document.getElementById('dashboard-body').innerHTML = `
    <div class="dash-grid">

      <div class="dash-panel">
        <div class="dash-panel-header">
          <span class="dash-icon">🍽</span>
          <div>
            <div class="dash-panel-title">Restaurants</div>
            <div class="dash-panel-sub">${restaurants.length} total · avg ⭐ ${avgRating(restaurants)}</div>
          </div>
        </div>
        <div class="dash-chart">
          <div class="dash-axis-labels">
            ${RATING_BANDS.map(b => `<div class="dash-axis-label" style="color:${b.color}">⭐</div>`).join('')}
          </div>
          ${renderChart(restBands, restaurants.length)}
        </div>
      </div>

      <div class="dash-panel">
        <div class="dash-panel-header">
          <span class="dash-icon">☕</span>
          <div>
            <div class="dash-panel-title">Coffee Shops</div>
            <div class="dash-panel-sub">${cafes.length} total · avg ⭐ ${avgRating(cafes)}</div>
          </div>
        </div>
        <div class="dash-chart">
          ${renderChart(cafeBands, cafes.length)}
        </div>
      </div>

    </div>

    <div class="dash-legend">
      ${RATING_BANDS.map(b => `
        <div class="dash-legend-item">
          <span class="dash-legend-dot" style="background:${b.color}"></span>
          ${b.label}
        </div>`).join('')}
    </div>`;
}

document.getElementById('dashboard-refresh').addEventListener('click', loadDashboard);

// ── Stats ──
async function loadStats() {
  log('INFO', 'Fetching database stats');
  const [placesRes, cafesRes, restRes, bookingsRes, syncRes] = await Promise.all([
    db.from('places').select('*', { count: 'exact', head: true }),
    db.from('places').select('*', { count: 'exact', head: true }).eq('place_type', 'cafe'),
    db.from('places').select('*', { count: 'exact', head: true }).eq('place_type', 'restaurant'),
    db.from('bookings').select('*', { count: 'exact', head: true }),
    db.from('places').select('updated_at').order('updated_at', { ascending: false }).limit(1),
  ]);

  document.getElementById('stat-total').textContent       = placesRes.count ?? '—';
  document.getElementById('stat-cafes').textContent       = cafesRes.count ?? '—';
  document.getElementById('stat-restaurants').textContent = restRes.count ?? '—';
  document.getElementById('stat-bookings').textContent    = bookingsRes.count ?? '—';
  const lastSync = syncRes.data?.[0]?.updated_at;
  document.getElementById('stat-synced').textContent = lastSync
    ? new Date(lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

  log('SUCCESS', `Stats loaded`,
    `${placesRes.count} places (${cafesRes.count} cafes, ${restRes.count} restaurants) · ${bookingsRes.count} bookings`);
}

// ── Load settings ──
let currentCfg = {};
async function loadSettings() {
  log('INFO', 'Loading fetch config from Supabase settings table');
  const { data, error } = await db.from('settings').select('*').eq('key', 'fetch_config').single();

  if (error && error.code !== 'PGRST116') {
    log('ERROR', 'Failed to load settings', error.message);
    return;
  }

  currentCfg = data?.value || {
    radius: 3500, type: 'food', keyword: '', max_pages: 3,
    areas: LISBON_AREAS.map(a => a.name),
  };

  document.getElementById('cfg-radius').value       = currentCfg.radius || 3500;
  document.getElementById('cfg-radius-range').value = currentCfg.radius || 3500;
  document.getElementById('cfg-type').value         = currentCfg.type ?? 'food';
  document.getElementById('cfg-keyword').value      = currentCfg.keyword || '';
  const pages = currentCfg.max_pages || 3;
  document.querySelector(`input[name="pages"][value="${pages}"]`).checked = true;

  if (data) {
    log('SUCCESS', 'Settings loaded', JSON.stringify(currentCfg));
  } else {
    log('WARN', 'No saved settings found — using defaults');
  }

  updateFetchInfo();
}

// ── Areas grid ──
function buildAreasGrid() {
  const grid = document.getElementById('areas-grid');
  const enabledAreas = currentCfg.areas || LISBON_AREAS.map(a => a.name);
  grid.innerHTML = LISBON_AREAS.map(area => `
    <label class="area-check">
      <input type="checkbox" name="area" value="${area.name}"
        ${enabledAreas.includes(area.name) ? 'checked' : ''} />
      ${area.name}
    </label>`).join('');
  grid.querySelectorAll('input').forEach(cb => cb.addEventListener('change', updateFetchInfo));
}

// ── Fetch info summary ──
function updateFetchInfo() {
  const radius  = parseInt(document.getElementById('cfg-radius').value);
  const type    = document.getElementById('cfg-type').value;
  const keyword = document.getElementById('cfg-keyword').value.trim();
  const pages   = parseInt(document.querySelector('input[name="pages"]:checked')?.value || 3);
  const areas   = [...document.querySelectorAll('input[name="area"]:checked')].map(c => c.value);
  const maxResults = areas.length * pages * 20;

  document.getElementById('fetch-info').innerHTML = `
    <div class="info-box">
      <strong>${areas.length}</strong> area${areas.length !== 1 ? 's' : ''} ×
      <strong>${pages}</strong> page${pages !== 1 ? 's' : ''} =
      <strong>${areas.length * pages}</strong> API requests per fetch ·
      up to <strong>${maxResults}</strong> results ·
      radius <strong>${(radius/1000).toFixed(1)} km</strong>
      ${type    ? `· type: <strong>${type}</strong>` : ''}
      ${keyword ? `· keyword: <strong>"${keyword}"</strong>` : ''}
    </div>`;
}

// ── Range ↔ number sync ──
document.getElementById('cfg-radius-range').addEventListener('input', e => {
  document.getElementById('cfg-radius').value = e.target.value;
  updateFetchInfo();
});
document.getElementById('cfg-radius').addEventListener('input', e => {
  document.getElementById('cfg-radius-range').value = e.target.value;
  updateFetchInfo();
});
document.getElementById('cfg-type').addEventListener('change', updateFetchInfo);
document.getElementById('cfg-keyword').addEventListener('input', updateFetchInfo);
document.querySelectorAll('input[name="pages"]').forEach(r => r.addEventListener('change', updateFetchInfo));

document.getElementById('select-all').addEventListener('click', () => {
  document.querySelectorAll('input[name="area"]').forEach(c => c.checked = true);
  updateFetchInfo();
});
document.getElementById('deselect-all').addEventListener('click', () => {
  document.querySelectorAll('input[name="area"]').forEach(c => c.checked = false);
  updateFetchInfo();
});

// ── Save settings ──
document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const cfg = {
    radius:    parseInt(document.getElementById('cfg-radius').value),
    type:      document.getElementById('cfg-type').value,
    keyword:   document.getElementById('cfg-keyword').value.trim(),
    max_pages: parseInt(document.querySelector('input[name="pages"]:checked').value),
    areas:     [...document.querySelectorAll('input[name="area"]:checked')].map(c => c.value),
  };

  const status = document.getElementById('save-status');
  status.textContent = 'Saving…';
  status.className = 'save-status saving';
  log('INFO', 'Saving settings to Supabase', JSON.stringify(cfg));

  const { error } = await db.from('settings').upsert(
    { key: 'fetch_config', value: cfg, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );

  if (error) {
    status.textContent = '❌ Save failed';
    status.className = 'save-status error';
    log('ERROR', 'Failed to save settings', error.message);
  } else {
    currentCfg = cfg;
    status.textContent = '✅ Saved!';
    status.className = 'save-status success';
    setTimeout(() => { status.textContent = ''; }, 3000);
    log('SUCCESS', 'Settings saved successfully');
  }
});

// ── Fetch from Google API ──
document.getElementById('fetch-btn').addEventListener('click', async () => {
  if (!placesService) {
    log('WARN', 'Google Maps not ready yet — please wait a moment');
    return;
  }

  const btn = document.getElementById('fetch-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching…';

  const { data: settingsData, error: settingsError } = await db.from('settings')
    .select('*').eq('key', 'fetch_config').single();

  if (settingsError && settingsError.code !== 'PGRST116') {
    log('ERROR', 'Failed to read settings before fetch', settingsError.message);
  }

  const cfg      = settingsData?.value || {};
  const radius   = cfg.radius    || 3500;
  const type     = cfg.type      || 'food';
  const keyword  = cfg.keyword   || '';
  const maxPages = cfg.max_pages || 3;
  const enabledAreas = cfg.areas
    ? LISBON_AREAS.filter(a => cfg.areas.includes(a.name))
    : LISBON_AREAS;

  log('INFO', '─── Fetch started ───');
  log('INFO', `Config: radius=${radius}m, type="${type}", keyword="${keyword}", maxPages=${maxPages}`);
  log('INFO', `Areas: ${enabledAreas.map(a => a.name).join(', ')}`);
  log('INFO', `Total requests: up to ${enabledAreas.length * maxPages}`);

  const raw = [];
  const seenIds = new Set();
  let pending = 0;
  let totalReturned = 0;
  let totalSkipped = 0;

  function classifyType(types = []) {
    if (types.includes('cafe') || types.includes('bakery')) return 'cafe';
    if (types.includes('restaurant') || types.includes('bar') || types.includes('meal_takeaway')) return 'restaurant';
    return null;
  }

  async function onAllDone() {
    log('INFO', `─── All areas fetched ───`);
    log('INFO', `Total returned by Google: ${totalReturned} · Skipped (no type / duplicate): ${totalSkipped} · New unique places: ${raw.length}`);
    log('INFO', `Saving ${raw.length} places to Supabase in batches of 50…`);

    const rows = raw.map(p => ({
      place_id: p.place_id,
      name: p.name,
      vicinity: p.vicinity || '',
      rating: p.rating || 0,
      user_ratings_total: p.user_ratings_total || 0,
      area: p._area,
      place_type: p._type,
      lat: p.geometry?.location?.lat() || 0,
      lng: p.geometry?.location?.lng() || 0,
      photo_url: p.photos?.[0]?.getUrl({ maxWidth: 600, maxHeight: 360 }) || null,
      opening_hours_text: p.opening_hours?.weekday_text || [],
      updated_at: new Date().toISOString(),
    }));

    const BATCH = 50;
    let saved = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await db.from('places').upsert(batch, { onConflict: 'place_id' });
      if (error) {
        log('ERROR', `Batch ${Math.floor(i/BATCH)+1} failed`, error.message);
      } else {
        saved += batch.length;
        log('SUCCESS', `Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(rows.length/BATCH)} saved`, `${saved}/${rows.length} total`);
      }
    }

    log('SUCCESS', `─── Fetch complete: ${saved} places saved to database ───`);
    btn.disabled = false;
    btn.textContent = '🔄 Fetch from Google API';
    loadStats();
  }

  function searchArea(area) {
    pending++;
    let pageCount = 0;
    const request = { location: new google.maps.LatLng(area.lat, area.lng), radius };
    if (type)    request.type    = type;
    if (keyword) request.keyword = keyword;

    log('INFO', `→ Searching "${area.name}"`, `lat:${area.lat}, lng:${area.lng}, radius:${radius}m`);

    function handlePage(results, status, pagination) {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        pageCount++;
        let newCount = 0, skipType = 0, skipDupe = 0;

        results.forEach(p => {
          totalReturned++;
          const placeType = classifyType(p.types);
          if (!placeType) { skipType++; totalSkipped++; return; }
          if (seenIds.has(p.place_id)) { skipDupe++; totalSkipped++; return; }
          seenIds.add(p.place_id);
          p._area = area.name;
          p._type = placeType;
          raw.push(p);
          newCount++;
        });

        log(
          newCount > 0 ? 'INFO' : 'WARN',
          `  "${area.name}" page ${pageCount}: ${results.length} returned`,
          `+${newCount} new · ${skipDupe} dupes · ${skipType} wrong type`
        );

        if (pagination && pagination.hasNextPage && pageCount < maxPages) {
          log('INFO', `  "${area.name}" has more results — fetching page ${pageCount + 1}`);
          setTimeout(() => pagination.nextPage(), 300);
          return;
        }

        if (!pagination?.hasNextPage) {
          log('INFO', `  "${area.name}" — no more pages`);
        } else if (pageCount >= maxPages) {
          log('WARN', `  "${area.name}" — stopped at page limit (${maxPages})`);
        }

      } else if (status !== google.maps.places.PlacesServiceStatus.OK) {
        log('ERROR', `  "${area.name}" request failed`, `status: ${status}`);
      }

      pending--;
      if (pending === 0) onAllDone();
    }

    placesService.nearbySearch(request, handlePage);
  }

  enabledAreas.forEach((area, i) => setTimeout(() => searchArea(area), i * 200));
});

// ── Clear database ──
document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm('Are you sure? This will delete ALL places from the database.')) return;
  log('WARN', 'Clearing all places from database…');
  const { error } = await db.from('places').delete().neq('place_id', '');
  if (error) {
    log('ERROR', 'Failed to clear database', error.message);
  } else {
    log('SUCCESS', 'All places deleted from database');
    loadStats();
  }
});

init();
