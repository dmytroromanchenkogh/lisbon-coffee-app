let allPlaces = [];
let selectedPlace = null;

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

function initMap() {
  const map = new google.maps.Map(document.createElement('div'));
  const service = new google.maps.places.PlacesService(map);
  const seenIds = new Set();
  let pending = 0;

  function onAllDone() {
    if (allPlaces.length === 0) {
      document.getElementById('cards-container').innerHTML =
        '<p class="no-results">Could not load coffee shops. Please check your API key.</p>';
    } else {
      populateAreaFilter();
      renderCards();
    }
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

  document.getElementById('cards-container').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading coffee shops across Lisbon…</p>
    </div>`;

  LISBON_AREAS.forEach((area, i) => setTimeout(() => searchArea(area), i * 200));
}

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
  if (!place.opening_hours || !place.opening_hours.weekday_text) return null;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = days[new Date().getDay()];
  const line = place.opening_hours.weekday_text.find(t => t.startsWith(today));
  return line ? line.replace(today + ': ', '') : null;
}

function renderCards() {
  const minRating = parseFloat(document.getElementById('filter-rating').value);
  const openOnly = document.getElementById('filter-open').checked;

  const query = document.getElementById('filter-search').value.trim().toLowerCase();
  const area = document.getElementById('filter-area').value;

  let filtered = allPlaces.filter(p => {
    if (p.rating < minRating) return false;
    if (openOnly && !p.opening_hours?.open_now) return false;
    if (query && !p.name.toLowerCase().includes(query)) return false;
    if (area && p._area !== area) return false;
    return true;
  });

  const container = document.getElementById('cards-container');
  document.getElementById('result-count').textContent =
    `${filtered.length} place${filtered.length !== 1 ? 's' : ''} found`;

  if (filtered.length === 0) {
    container.innerHTML = '<p class="no-results">No coffee shops match your filters. Try adjusting them.</p>';
    return;
  }

  // Sort by rating descending
  filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));

  container.innerHTML = filtered.map(place => {
    const isOpen = place.opening_hours?.open_now;
    const photo = place.photos?.[0]?.getUrl({ maxWidth: 600, maxHeight: 400 });
    const hours = getTodayHours(place);
    const rating = place.rating || 0;
    const reviews = place.user_ratings_total || 0;

    return `
      <div class="card" data-id="${place.place_id}">
        ${photo
          ? `<img class="card-photo" src="${photo}" alt="${place.name}" loading="lazy" />`
          : `<div class="card-photo-placeholder">☕</div>`}
        <div class="card-body">
          <div class="card-name">${place.name}</div>
          <div class="card-address">${place.vicinity || ''}</div>
          ${place._area ? `<div class="card-area">${place._area}</div>` : ''}
          <div class="card-meta">
            <span class="stars">${starsHTML(rating)}</span>
            <span class="rating-num">${rating.toFixed(1)}</span>
            <span class="review-count">(${reviews.toLocaleString()})</span>
            <span class="badge ${isOpen ? 'badge-open' : 'badge-closed'}">
              ${isOpen ? 'Open now' : 'Closed'}
            </span>
          </div>
          ${hours ? `<div class="card-hours">Today: ${hours}</div>` : ''}
          <button class="btn-book" onclick="openBooking('${place.place_id}')">
            Book a Table
          </button>
        </div>
      </div>`;
  }).join('');
}

function openBooking(placeId) {
  selectedPlace = allPlaces.find(p => p.place_id === placeId);
  if (!selectedPlace) return;

  document.getElementById('modal-title').textContent = selectedPlace.name;
  document.getElementById('modal-address').textContent = selectedPlace.vicinity || '';
  document.getElementById('booking-form').classList.remove('hidden');
  document.getElementById('booking-success').classList.add('hidden');

  // Default date to tomorrow
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

  // Save to localStorage
  const bookings = JSON.parse(localStorage.getItem('lisbonCoffeeBookings') || '[]');
  bookings.push(booking);
  localStorage.setItem('lisbonCoffeeBookings', JSON.stringify(bookings));

  // Show success
  document.getElementById('booking-form').classList.add('hidden');
  const detail = document.getElementById('success-detail');
  detail.textContent =
    `${booking.name}, your table for ${booking.guests} at ${booking.place} on ${booking.date} at ${booking.time} is confirmed!`;
  document.getElementById('booking-success').classList.remove('hidden');
});

document.getElementById('filter-rating').addEventListener('change', renderCards);
document.getElementById('filter-open').addEventListener('change', renderCards);
document.getElementById('filter-search').addEventListener('input', renderCards);
document.getElementById('filter-area').addEventListener('change', renderCards);
