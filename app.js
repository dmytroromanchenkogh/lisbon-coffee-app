// ── Supabase ──
const SUPABASE_URL = 'https://mbflfmgwhlytcpkrooww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UlZ7_KXAiIJ3i7i2ln3vhA_COsIP6VR';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ──
let allPlaces = [];
let selectedPlace = null;
let placesService = null;
let userLocation = null;

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

// ── Normalize place objects ──
function fromAPI(p) {
  return {
    place_id: p.place_id,
    name: p.name,
    vicinity: p.vicinity || '',
    rating: p.rating || 0,
    user_ratings_total: p.user_ratings_total || 0,
    _area: p._area || '',
    _type: p._type || 'cafe',
    lat: p.geometry?.location?.lat() || 0,
    lng: p.geometry?.location?.lng() || 0,
    photoUrl: p.photos?.[0]?.getUrl({ maxWidth: 600, maxHeight: 360 }) || null,
    openNow: p.opening_hours?.open_now ?? null,
    hoursText: p.opening_hours?.weekday_text || [],
  };
}

function fromDB(row) {
  return {
    place_id: row.place_id,
    name: row.name,
    vicinity: row.vicinity || '',
    rating: row.rating || 0,
    user_ratings_total: row.user_ratings_total || 0,
    _area: row.area || '',
    _type: row.place_type || 'cafe',
    lat: row.lat || 0,
    lng: row.lng || 0,
    photoUrl: row.photo_url || null,
    openNow: null,
    hoursText: row.opening_hours_text || [],
  };
}

// ── Haversine distance ──
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
}

// ── Google Maps init (needed for Places API) ──
function initMap() {
  const map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 38.7169, lng: -9.1399 }, zoom: 13,
  });
  placesService = new google.maps.places.PlacesService(map);
  loadFromDatabase();
}

// ── 1. Load from Supabase ──
async function loadFromDatabase() {
  const { data, error } = await db.from('places').select('*');
  if (error || !data || data.length === 0) {
    showBanner('No cached data found. Fetching from Google…', 'info');
    fetchFromAPI();
    return;
  }
  allPlaces = data.map(fromDB);
  showBanner(`📦 Loaded ${allPlaces.length} places from database · Last synced: ${formatDate(data[0]?.updated_at)}`, 'cache');
  populateAreaFilter();
  renderCards();
}

// ── 2. Fetch from Google Places API ──
async function fetchFromAPI() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching…';

  document.getElementById('cards-container').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Fetching live data from Google Places…</p>
    </div>`;

  // Load settings from Supabase
  const { data: settingsData } = await db.from('settings').select('*').eq('key', 'fetch_config').single();
  const cfg = settingsData?.value || {};
  const radius   = cfg.radius    || 3500;
  const type     = cfg.type      || 'food';
  const keyword  = cfg.keyword   || '';
  const maxPages = cfg.max_pages || 3;
  const presetAreas  = cfg.areas
    ? LISBON_AREAS.filter(a => cfg.areas.includes(a.name))
    : LISBON_AREAS;
  const enabledAreas = [...presetAreas, ...(cfg.custom_areas || [])];

  const raw = [];
  const seenIds = new Set();
  let pending = 0;

  function classifyType(types = []) {
    if (types.includes('cafe') || types.includes('bakery')) return 'cafe';
    if (types.includes('restaurant') || types.includes('bar') || types.includes('meal_takeaway')) return 'restaurant';
    return null;
  }

  function onAllDone() {
    saveToDatabase(raw.map(fromAPI));
  }

  function searchArea(area) {
    pending++;
    let pageCount = 0;
    const request = { location: new google.maps.LatLng(area.lat, area.lng), radius };
    if (type)    request.type    = type;
    if (keyword) request.keyword = keyword;

    function handlePage(results, status, pagination) {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        results.forEach(p => {
          const placeType = classifyType(p.types);
          if (!placeType) return;
          if (!seenIds.has(p.place_id)) {
            seenIds.add(p.place_id);
            p._area = area.name;
            p._type = placeType;
            raw.push(p);
          }
        });
        pageCount++;
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
}

// ── 3. Save to Supabase ──
async function saveToDatabase(normalized) {
  const rows = normalized.map(p => ({
    place_id: p.place_id,
    name: p.name,
    vicinity: p.vicinity,
    rating: p.rating,
    user_ratings_total: p.user_ratings_total,
    area: p._area,
    place_type: p._type,
    lat: p.lat,
    lng: p.lng,
    photo_url: p.photoUrl,
    opening_hours_text: p.hoursText,
    updated_at: new Date().toISOString(),
  }));

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.from('places').upsert(rows.slice(i, i + BATCH), { onConflict: 'place_id' });
  }

  allPlaces = normalized;

  const btn = document.getElementById('refresh-btn');
  btn.disabled = false;
  btn.textContent = '🔄 Refresh data';

  showBanner(`✅ Synced ${allPlaces.length} places from Google · Live data`, 'live');
  document.getElementById('filter-area').innerHTML = '<option value="">All areas</option>';
  populateAreaFilter();
  renderCards();
}

// ── Filters ──
function populateAreaFilter() {
  const select = document.getElementById('filter-area');
  const areas = [...new Set(allPlaces.map(p => p._area).filter(Boolean))].sort();
  areas.forEach(area => {
    const opt = document.createElement('option');
    opt.value = area;
    opt.textContent = area;
    select.appendChild(opt);
  });
}

function starsHTML(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function getTodayHours(place) {
  if (!place.hoursText?.length) return null;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = days[new Date().getDay()];
  const line = place.hoursText.find(t => t.startsWith(today));
  return line ? line.replace(today + ': ', '') : null;
}

// ── Render cards ──
function renderCards() {
  const minRating = parseFloat(document.getElementById('filter-rating').value);
  const openOnly = document.getElementById('filter-open').checked;
  const byDistance = document.getElementById('filter-distance').checked;
  const query = document.getElementById('filter-search').value.trim().toLowerCase();
  const area = document.getElementById('filter-area').value;
  const typeFilter = document.getElementById('filter-type').value;

  let filtered = allPlaces.filter(p => {
    if (p.rating < minRating) return false;
    if (openOnly && p.openNow !== true) return false;
    if (query && !p.name.toLowerCase().includes(query)) return false;
    if (area && p._area !== area) return false;
    if (typeFilter && p._type !== typeFilter) return false;
    return true;
  });

  if (userLocation) {
    filtered.forEach(p => {
      p._dist = distanceKm(userLocation.lat, userLocation.lng, p.lat, p.lng);
    });
  }

  filtered.sort((a, b) =>
    byDistance && userLocation
      ? (a._dist || 999) - (b._dist || 999)
      : b.rating - a.rating
  );

  document.getElementById('result-count').textContent =
    `${filtered.length} place${filtered.length !== 1 ? 's' : ''} found`;

  const container = document.getElementById('cards-container');

  if (filtered.length === 0) {
    container.innerHTML = '<p class="no-results">No places match your filters.</p>';
    return;
  }

  container.innerHTML = filtered.map(place => {
    const hours = getTodayHours(place);
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
    const openBadge = place.openNow === true
      ? '<span class="badge badge-open">Open now</span>'
      : place.openNow === false
        ? '<span class="badge badge-closed">Closed</span>'
        : '';

    return `
      <div class="card">
        ${place.photoUrl
          ? `<img class="card-photo" src="${place.photoUrl}" alt="${place.name}" loading="lazy" />`
          : `<div class="card-photo-placeholder">${place._type === 'restaurant' ? '🍽' : '☕'}</div>`}
        <div class="card-body">
          <div class="card-name">${place.name}</div>
          <div class="card-address">${place.vicinity}</div>
          <div class="card-meta">
            <span class="stars">${starsHTML(place.rating)}</span>
            <span class="rating-num">${place.rating.toFixed(1)}</span>
            <span class="review-count">(${place.user_ratings_total.toLocaleString()})</span>
            ${openBadge}
          </div>
          ${place._area ? `<div class="card-area">${place._area}</div>` : ''}
          ${hours ? `<div class="card-hours">Today: ${hours}</div>` : ''}
          ${place._dist != null ? `<div class="card-distance">📍 ${formatDistance(place._dist)}</div>` : ''}
          <div class="card-actions">
            <button class="btn-book" onclick="openBooking('${place.place_id}')">
              Book a Table
            </button>
            <a class="btn-directions" href="${mapsUrl}" target="_blank" title="Get directions">🗺</a>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Banner ──
function showBanner(msg, type = '') {
  const el = document.getElementById('data-source-banner');
  if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg;
  el.className = `data-banner banner-${type}`;
}

function formatDate(iso) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Near me ──
document.getElementById('near-me-btn').addEventListener('click', () => {
  const btn = document.getElementById('near-me-btn');
  if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
  btn.textContent = '⏳ Locating…';
  btn.classList.add('locating');

  navigator.geolocation.getCurrentPosition(pos => {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    document.getElementById('filter-distance').checked = true;
    btn.textContent = '📍 Near me';
    btn.classList.remove('locating');
    renderCards();
  }, () => {
    alert('Could not get your location. Please allow location access.');
    btn.textContent = '📍 Near me';
    btn.classList.remove('locating');
  });
});

// ── Refresh button ──
document.getElementById('refresh-btn').addEventListener('click', fetchFromAPI);

// ── Booking modal ──
function openBooking(placeId) {
  selectedPlace = allPlaces.find(p => p.place_id === placeId);
  if (!selectedPlace) return;

  document.getElementById('modal-title').textContent = selectedPlace.name;
  document.getElementById('modal-address').textContent = selectedPlace.vicinity;
  document.getElementById('booking-form').classList.remove('hidden');
  document.getElementById('booking-success').classList.add('hidden');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('b-date').value = tomorrow.toISOString().split('T')[0];
  document.getElementById('b-date').min = new Date().toISOString().split('T')[0];

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

document.getElementById('booking-form').addEventListener('submit', async e => {
  e.preventDefault();
  const booking = {
    place_id: selectedPlace.place_id,
    place_name: selectedPlace.name,
    place_address: selectedPlace.vicinity,
    guest_name: document.getElementById('b-name').value,
    email: document.getElementById('b-email').value,
    date: document.getElementById('b-date').value,
    time: document.getElementById('b-time').value,
    guests: document.getElementById('b-guests').value,
  };

  await db.from('bookings').insert(booking);

  document.getElementById('booking-form').classList.add('hidden');
  document.getElementById('success-detail').textContent =
    `${booking.guest_name}, your table for ${booking.guests} at ${booking.place_name} on ${booking.date} at ${booking.time} is confirmed!`;
  document.getElementById('booking-success').classList.remove('hidden');
});

// ── Filter listeners ──
['filter-rating', 'filter-area', 'filter-type'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderCards));
['filter-open', 'filter-distance'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderCards));
document.getElementById('filter-search').addEventListener('input', renderCards);
