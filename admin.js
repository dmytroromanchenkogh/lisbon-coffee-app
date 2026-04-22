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
}

// ── Init ──
async function init() {
  await Promise.all([loadStats(), loadSettings()]);
  buildAreasGrid();
}

// ── Stats ──
async function loadStats() {
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
}

// ── Load settings ──
let currentCfg = {};
async function loadSettings() {
  const { data } = await db.from('settings').select('*').eq('key', 'fetch_config').single();
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
    </label>
  `).join('');
  grid.querySelectorAll('input').forEach(cb => cb.addEventListener('change', updateFetchInfo));
}

// ── Fetch info summary ──
function updateFetchInfo() {
  const radius   = parseInt(document.getElementById('cfg-radius').value);
  const type     = document.getElementById('cfg-type').value;
  const keyword  = document.getElementById('cfg-keyword').value.trim();
  const pages    = parseInt(document.querySelector('input[name="pages"]:checked')?.value || 3);
  const areas    = [...document.querySelectorAll('input[name="area"]:checked')].map(c => c.value);
  const requests = areas.length;
  const maxResults = requests * pages * 20;

  document.getElementById('fetch-info').innerHTML = `
    <div class="info-box">
      <strong>${requests}</strong> area${requests !== 1 ? 's' : ''} ×
      <strong>${pages}</strong> page${pages !== 1 ? 's' : ''} =
      <strong>${requests * pages}</strong> API requests per fetch ·
      up to <strong>${maxResults}</strong> results ·
      radius <strong>${(radius/1000).toFixed(1)} km</strong>
      ${type ? `· type: <strong>${type}</strong>` : ''}
      ${keyword ? `· keyword: <strong>"${keyword}"</strong>` : ''}
    </div>`;
}

// ── Sync range ↔ number input ──
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

// ── Select / Deselect all areas ──
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

  const { error } = await db.from('settings').upsert(
    { key: 'fetch_config', value: cfg, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );

  if (error) {
    status.textContent = '❌ Save failed';
    status.className = 'save-status error';
  } else {
    currentCfg = cfg;
    status.textContent = '✅ Saved!';
    status.className = 'save-status success';
    setTimeout(() => { status.textContent = ''; }, 3000);
  }
});

// ── Fetch now ──
document.getElementById('fetch-btn').addEventListener('click', async () => {
  if (!placesService) {
    alert('Google Maps still loading, please wait a moment.');
    return;
  }

  const btn = document.getElementById('fetch-btn');
  const log = document.getElementById('fetch-log');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching…';
  log.classList.remove('hidden');
  log.textContent = '';

  function addLog(msg) {
    log.textContent += msg + '\n';
    log.scrollTop = log.scrollHeight;
  }

  // Read current settings
  const { data: settingsData } = await db.from('settings').select('*').eq('key', 'fetch_config').single();
  const cfg = settingsData?.value || {};
  const radius   = cfg.radius    || 3500;
  const type     = cfg.type      || 'food';
  const keyword  = cfg.keyword   || '';
  const maxPages = cfg.max_pages || 3;
  const enabledAreas = cfg.areas
    ? LISBON_AREAS.filter(a => cfg.areas.includes(a.name))
    : LISBON_AREAS;

  addLog(`Starting fetch: ${enabledAreas.length} areas, radius ${radius}m, type "${type}", max ${maxPages} pages`);

  const raw = [];
  const seenIds = new Set();
  let pending = 0;

  function classifyType(types = []) {
    if (types.includes('cafe') || types.includes('bakery')) return 'cafe';
    if (types.includes('restaurant') || types.includes('bar') || types.includes('meal_takeaway')) return 'restaurant';
    return null;
  }

  async function onAllDone() {
    addLog(`\nFetched ${raw.length} unique places. Saving to database…`);

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
    for (let i = 0; i < rows.length; i += BATCH) {
      await db.from('places').upsert(rows.slice(i, i + BATCH), { onConflict: 'place_id' });
      addLog(`Saved batch ${Math.floor(i/BATCH)+1}/${Math.ceil(rows.length/BATCH)}`);
    }

    addLog(`\n✅ Done! ${rows.length} places saved.`);
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

    function handlePage(results, status, pagination) {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        let added = 0;
        results.forEach(p => {
          const placeType = classifyType(p.types);
          if (!placeType) return;
          if (!seenIds.has(p.place_id)) {
            seenIds.add(p.place_id);
            p._area = area.name;
            p._type = placeType;
            raw.push(p);
            added++;
          }
        });
        pageCount++;
        addLog(`  ${area.name} — page ${pageCount}: +${added} new (${results.length} returned)`);
        if (pagination && pagination.hasNextPage && pageCount < maxPages) {
          setTimeout(() => pagination.nextPage(), 300);
          return;
        }
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
  const { error } = await db.from('places').delete().neq('place_id', '');
  if (error) {
    alert('Error clearing database: ' + error.message);
  } else {
    alert('All places deleted.');
    loadStats();
  }
});

init();
