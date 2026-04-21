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
  { name: 'Santos / Estrela',    lat: 38.7075, lng: -9.1535 },
  { name: 'Belém',               lat: 38.6977, lng: -9.2059 },
  { name: 'Avenidas Novas',      lat: 38.7310, lng: -9.1490 },
  { name: 'Parque das Nações',   lat: 38.7652, lng: -9.0949 },
  { name: 'Campo de Ourique',    lat: 38.7132, lng: -9.1605 },
];

// ── Haversine distance in km ──
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

// ── Map init ──
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

  loadAllPlaces();
}

function loadAllPlaces() {
  const dummy = new google.maps.Map(document.createElement('div'));
  const service = new google.maps.places.PlacesService(dummy);
  const seenIds = new Set();
  let pending = 0;

  function onAllDone() {
    if (allPlaces.length === 0) {
      document.getElementById('cards-container').innerHTML =
        '<p class="no-results">Could not load coffee shops. Please check your API key.</p>';
      return;
    }
    populateAreaFilter();
    placeMarkers();
    renderCards();
  }

  function searchArea(area) {
    pending++;
    const request = {
      location: new google.maps.LatLng(area.lat, area.lng),
      radius: 900,
      type: 'cafe',
      keyword: 'coffee',
    };

    function handlePage(results, status, pagination) {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        results.forEach(p => {
          if (!seenIds.has(p.place_id)) {
            seenIds.add(p.place_id);
            p._area = area.name;
            allPlaces.push(p);
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

// ── Markers ──
function placeMarkers() {
  // Clear old markers
  Object.values(markers).forEach(m => m.setMap(null));
  markers = {};

  allPlaces.forEach(place => {
    if (!place.geometry?.location) return;

    const marker = new google.maps.Marker({
      map,
      position: place.geometry.location,
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

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-family:sans-serif;max-width:200px;padding:4px">
          <strong style="font-size:0.9rem">${place.name}</strong><br/>
          <span style="font-size:0.78rem;color:#888">${place.vicinity || ''}</span><br/>
          <span style="color:#f59e0b">★</span>
          <span style="font-size:0.82rem;font-weight:600">${place.rating?.toFixed(1) || '–'}</span>
          <span style="font-size:0.75rem;color:#aaa">(${place.user_ratings_total || 0})</span>
          <br/>
          <span style="font-size:0.75rem;font-weight:600;color:${place.opening_hours?.open_now ? '#059669' : '#dc2626'}">
            ${place.opening_hours?.open_now ? 'Open now' : 'Closed'}
          </span>
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
  if (!place.opening_hours?.weekday_text) return null;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = days[new Date().getDay()];
  const line = place.opening_hours.weekday_text.find(t => t.startsWith(today));
  return line ? line.replace(today + ': ', '') : null;
}

// ── Render cards ──
function renderCards() {
  const minRating = parseFloat(document.getElementById('filter-rating').value);
  const openOnly = document.getElementById('filter-open').checked;
  const byDistance = document.getElementById('filter-distance').checked;
  const query = document.getElementById('filter-search').value.trim().toLowerCase();
  const area = document.getElementById('filter-area').value;

  let filtered = allPlaces.filter(p => {
    if ((p.rating || 0) < minRating) return false;
    if (openOnly && !p.opening_hours?.open_now) return false;
    if (query && !p.name.toLowerCase().includes(query)) return false;
    if (area && p._area !== area) return false;
    return true;
  });

  // Compute distances if user location known
  if (userLocation) {
    filtered.forEach(p => {
      if (p.geometry?.location) {
        p._dist = distanceKm(
          userLocation.lat, userLocation.lng,
          p.geometry.location.lat(), p.geometry.location.lng()
        );
      }
    });
  }

  if (byDistance && userLocation) {
    filtered.sort((a, b) => (a._dist || 999) - (b._dist || 999));
  } else {
    filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  document.getElementById('result-count').textContent =
    `${filtered.length} place${filtered.length !== 1 ? 's' : ''} found`;

  const container = document.getElementById('cards-container');

  if (filtered.length === 0) {
    container.innerHTML = '<p class="no-results">No coffee shops match your filters.</p>';
    return;
  }

  container.innerHTML = filtered.map(place => {
    const isOpen = place.opening_hours?.open_now;
    const photo = place.photos?.[0]?.getUrl({ maxWidth: 600, maxHeight: 300 });
    const hours = getTodayHours(place);
    const rating = place.rating || 0;
    const reviews = place.user_ratings_total || 0;
    const lat = place.geometry?.location?.lat();
    const lng = place.geometry?.location?.lng();
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

    return `
      <div class="card" id="card-${place.place_id}" onclick="focusMarker('${place.place_id}')">
        ${photo
          ? `<img class="card-photo" src="${photo}" alt="${place.name}" loading="lazy" />`
          : `<div class="card-photo-placeholder">☕</div>`}
        <div class="card-body">
          <div class="card-name">${place.name}</div>
          <div class="card-address">${place.vicinity || ''}</div>
          <div class="card-meta">
            <span class="stars">${starsHTML(rating)}</span>
            <span class="rating-num">${rating.toFixed(1)}</span>
            <span class="review-count">(${reviews.toLocaleString()})</span>
            <span class="badge ${isOpen ? 'badge-open' : 'badge-closed'}">
              ${isOpen ? 'Open now' : 'Closed'}
            </span>
          </div>
          ${place._area ? `<div class="card-area">${place._area}</div>` : ''}
          ${hours ? `<div class="card-hours">Today: ${hours}</div>` : ''}
          ${place._dist != null ? `<div class="card-distance">📍 ${formatDistance(place._dist)}</div>` : ''}
          <div class="card-actions">
            <button class="btn-book" onclick="event.stopPropagation(); openBooking('${place.place_id}')">
              Book a Table
            </button>
            <a class="btn-directions" href="${mapsUrl}" target="_blank"
               onclick="event.stopPropagation()" title="Get directions">
              🗺
            </a>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Near me ──
document.getElementById('near-me-btn').addEventListener('click', () => {
  const btn = document.getElementById('near-me-btn');
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  btn.textContent = '⏳ Locating…';
  btn.classList.add('locating');

  navigator.geolocation.getCurrentPosition(pos => {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };

    // Drop user pin
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

// ── Booking modal ──
function openBooking(placeId) {
  selectedPlace = allPlaces.find(p => p.place_id === placeId);
  if (!selectedPlace) return;

  document.getElementById('modal-title').textContent = selectedPlace.name;
  document.getElementById('modal-address').textContent = selectedPlace.vicinity || '';
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

document.getElementById('booking-form').addEventListener('submit', e => {
  e.preventDefault();
  const booking = {
    place: selectedPlace.name,
    address: selectedPlace.vicinity,
    name: document.getElementById('b-name').value,
    email: document.getElementById('b-email').value,
    date: document.getElementById('b-date').value,
    time: document.getElementById('b-time').value,
    guests: document.getElementById('b-guests').value,
    bookedAt: new Date().toISOString(),
  };
  const bookings = JSON.parse(localStorage.getItem('lisbonCoffeeBookings') || '[]');
  bookings.push(booking);
  localStorage.setItem('lisbonCoffeeBookings', JSON.stringify(bookings));

  document.getElementById('booking-form').classList.add('hidden');
  document.getElementById('success-detail').textContent =
    `${booking.name}, your table for ${booking.guests} at ${booking.place} on ${booking.date} at ${booking.time} is confirmed!`;
  document.getElementById('booking-success').classList.remove('hidden');
});

// ── Filters ──
['filter-rating', 'filter-area'].forEach(id =>
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
  // Trigger resize so map renders correctly after being hidden
  setTimeout(() => google.maps.event.trigger(map, 'resize'), 100);
});
