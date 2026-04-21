// ── Supabase ──
const SUPABASE_URL = 'https://mbflfmgwhlytcpkrooww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UlZ7_KXAiIJ3i7i2ln3vhA_COsIP6VR';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ──
let allPlaces = [];
let selectedPlace = null;
let map = null;
let markers = {};
let activeInfoWindow = null;
let userLocation = null;
let userMarker = null;

const LISBON_CENTER = { lat: 38.7169, lng: -9.1399 };

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

// ── Normalize place objects into a flat shape ──
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
    photoUrl: p.photos?.[0]?.getUrl({ maxWidth: 600, maxHeight: 300 }) || null,
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

// ── Map init (Google callback) ──
function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: LISBON_CENTER,
    zoom: 13,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    ],
  });

  loadFromDatabase();
}

// ── 1. Load from Supabase (fast startup) ──
async function loadFromDatabase() {
  showBanner('');
  const { data, error } = await db.from('places').select('*');

  if (error || !data || data.length === 0) {
    // Nothing cached yet — go straight to API
    showBanner('No cached data found. Fetching from Google…', 'info');
    fetchFromAPI();
    return;
  }

  allPlaces = data.map(fromDB);
  showBanner(`📦 Loaded ${allPlaces.length} places from database · Last synced: ${formatDate(data[0]?.updated_at)}`, 'cache');
  populateAreaFilter();
  placeMarkers();
  renderCards();
}

// ── 2. Fetch from Google Places API ──
function fetchFromAPI() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching…';

  document.getElementById('cards-container').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Fetching live data from Google Places…</p>
    </div>`;

  const dummy = new google.maps.Map(document.createElement('div'));
  const service = new google.maps.places.PlacesService(dummy);
  const raw = [];
  const seenIds = new Set();
  let pending = 0;

  function onAllDone() {
    const normalized = raw.map(fromAPI);
    saveToDatabase(normalized);
  }

  function classifyType(types = []) {
    if (types.includes('cafe') || types.includes('bakery')) return 'cafe';
    if (types.includes('restaurant') || types.includes('bar') || types.includes('meal_takeaway')) return 'restaurant';
    return null;
  }

  function searchArea(area) {
    pending++;
    const request = {
      location: new google.maps.LatLng(area.lat, area.lng),
      radius: 3500,
      type: 'food',
    };

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
        if (pagination && pagination.hasNextPage) {
          setTimeout(() => pagination.nextPage(), 300);
          return;
        }
      }
      pending--;
      if (pending === 0) onAllDone();
    }

    service.nearbySearch(request, handlePage);
  }

  LISBON_AREAS.forEach((area, i) => setTimeout(() => searchArea(area), i * 200));
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

  // Reset area filter options
  document.getElementById('filter-area').innerHTML = '<option value="">All areas</option>';
  populateAreaFilter();
  placeMarkers();
  renderCards();
}

// ── Markers ──
function placeMarkers() {
  Object.values(markers).forEach(m => m.setMap(null));
  markers = {};

  allPlaces.forEach(place => {
    if (!place.lat || !place.lng) return;

    const position = new google.maps.LatLng(place.lat, place.lng);

    const marker = new google.maps.Marker({
      map,
      position,
      title: place.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#5c3d2e',
        fillOpacity: 0.9,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
    });

    const openLabel = place.openNow === true
      ? '<span style="color:#059669;font-weight:600">Open now</span>'
      : place.openNow === false
        ? '<span style="color:#dc2626;font-weight:600">Closed</span>'
        : '';

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-family:sans-serif;max-width:200px;padding:4px">
          <strong style="font-size:0.9rem">${place.name}</strong><br/>
          <span style="font-size:0.78rem;color:#888">${place.vicinity}</span><br/>
          <span style="color:#f59e0b">★</span>
          <span style="font-size:0.82rem;font-weight:600">${place.rating.toFixed(1)}</span>
          <span style="font-size:0.75rem;color:#aaa">(${place.user_ratings_total.toLocaleString()})</span>
          ${openLabel ? `<br/>${openLabel}` : ''}
          <br/><br/>
          <button onclick="openBooking('${place.place_id}')"
            style="background:#5c3d2e;color:#fff;border:none;border-radius:6px;
                   padding:5px 12px;font-size:0.8rem;font-weight:600;cursor:pointer;width:100%">
            Book a Table
          </button>
        </div>`,
    });

    marker.addListener('click', () => {
      if (activeInfoWindow) activeInfoWindow.close();
      infoWindow.open(map, marker);
      activeInfoWindow = infoWindow;
      highlightCard(place.place_id);
    });

    markers[place.place_id] = marker;
  });
}

function highlightCard(placeId) {
  document.querySelectorAll('.card').forEach(c => c.classList.remove('highlighted'));
  const card = document.getElementById(`card-${placeId}`);
  if (card) {
    card.classList.add('highlighted');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function focusMarker(placeId) {
  if (activeInfoWindow) activeInfoWindow.close();
  const marker = markers[placeId];
  if (!marker) return;
  map.panTo(marker.getPosition());
  map.setZoom(16);
  google.maps.event.trigger(marker, 'click');
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

  if (byDistance && userLocation) {
    filtered.sort((a, b) => (a._dist || 999) - (b._dist || 999));
  } else {
    filtered.sort((a, b) => b.rating - a.rating);
  }

  document.getElementById('result-count').textContent =
    `${filtered.length} place${filtered.length !== 1 ? 's' : ''} found`;

  const container = document.getElementById('cards-container');

  if (filtered.length === 0) {
    container.innerHTML = '<p class="no-results">No coffee shops match your filters.</p>';
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
      <div class="card" id="card-${place.place_id}" onclick="focusMarker('${place.place_id}')">
        ${place.photoUrl
          ? `<img class="card-photo" src="${place.photoUrl}" alt="${place.name}" loading="lazy" />`
          : `<div class="card-photo-placeholder">☕</div>`}
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
            <button class="btn-book" onclick="event.stopPropagation(); openBooking('${place.place_id}')">
              Book a Table
            </button>
            <a class="btn-directions" href="${mapsUrl}" target="_blank"
               onclick="event.stopPropagation()" title="Get directions">🗺</a>
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

    if (userMarker) userMarker.setMap(null);
    userMarker = new google.maps.Marker({
      map,
      position: userLocation,
      title: 'You are here',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: '#3b82f6',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2.5,
      },
      zIndex: 999,
    });

    map.panTo(userLocation);
    map.setZoom(15);
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

// ── Mobile toggle ──
document.getElementById('toggle-list').addEventListener('click', () => {
  document.getElementById('list-pane').classList.remove('hidden-mobile');
  document.getElementById('map-pane').classList.add('hidden-mobile');
  document.getElementById('toggle-list').classList.add('active');
  document.getElementById('toggle-map').classList.remove('active');
});
document.getElementById('toggle-map').addEventListener('click', () => {
  document.getElementById('map-pane').classList.remove('hidden-mobile');
  document.getElementById('list-pane').classList.add('hidden-mobile');
  document.getElementById('toggle-map').classList.add('active');
  document.getElementById('toggle-list').classList.remove('active');
  setTimeout(() => google.maps.event.trigger(map, 'resize'), 100);
});
