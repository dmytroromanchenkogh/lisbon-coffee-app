let allPlaces = [];
let selectedPlace = null;

function initMap() {
  const lisbonCenter = { lat: 38.7169, lng: -9.1399 };

  const map = new google.maps.Map(document.createElement('div'));
  const service = new google.maps.places.PlacesService(map);

  const request = {
    location: new google.maps.LatLng(lisbonCenter.lat, lisbonCenter.lng),
    radius: 1500,
    type: 'cafe',
    keyword: 'coffee shop cafe',
  };

  service.nearbySearch(request, (results, status, pagination) => {
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      allPlaces = results;
      if (pagination && pagination.hasNextPage) {
        pagination.nextPage();
      } else {
        renderCards();
      }
    } else {
      document.getElementById('cards-container').innerHTML =
        '<p class="no-results">Could not load coffee shops. Please check your API key.</p>';
    }
  });

  // Accumulate paginated results
  const originalNearbySearch = service.nearbySearch.bind(service);
  service.nearbySearch = (req, cb) => {
    const wrappedCb = (results, status, pag) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        allPlaces = [...allPlaces, ...results];
        if (pag && pag.hasNextPage) {
          setTimeout(() => pag.nextPage(), 300);
        } else {
          renderCards();
        }
      }
      cb(results, status, pag);
    };
    originalNearbySearch(req, wrappedCb);
  };
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

  let filtered = allPlaces.filter(p => {
    if (p.rating < minRating) return false;
    if (openOnly && !p.opening_hours?.open_now) return false;
    if (query && !p.name.toLowerCase().includes(query)) return false;
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
