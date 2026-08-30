/**
 * AIRoadtrip — Markers, InfoWindows & Sidebar Module
 * Manages Google Maps markers, InfoWindows, geometric filtering,
 * rating filters, and bi-directional sidebar synchronization.
 */

let mapInstance = null;
let infoWindowInstance = null;
let activeMarkers = []; // Array of { id, marker, data }
let currentPlacesData = [];
let activePolygon = null;
let currentApiKey = '';
let currentMinRating = 1.0;
let sidebarListElement = null;
let sidebarCountElement = null;

const PRICE_SYMBOLS = {
  'PRICE_LEVEL_FREE': 'Free',
  'PRICE_LEVEL_INEXPENSIVE': '$',
  'PRICE_LEVEL_MODERATE': '$$',
  'PRICE_LEVEL_EXPENSIVE': '$$$',
  'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$'
};

/**
 * Initializes the markers module.
 * @param {google.maps.Map} map 
 * @param {google.maps.InfoWindow} infoWindow 
 * @param {HTMLElement} listEl 
 * @param {HTMLElement} countEl 
 */
export function initMarkers(map, infoWindow, listEl, countEl) {
  mapInstance = map;
  infoWindowInstance = infoWindow;
  sidebarListElement = listEl;
  sidebarCountElement = countEl;
}

/**
 * Sets the active Google API Key for photo loading.
 * @param {string} apiKey 
 */
export function setApiKey(apiKey) {
  currentApiKey = apiKey;
}

/**
 * Sets the active places dataset and polygon, then applies rating filter.
 * @param {Array<Object>} places 
 * @param {google.maps.Polygon} polygon 
 * @param {number} minRating 
 */
export function setPlaces(places, polygon, minRating = 1.0) {
  currentPlacesData = places || [];
  activePolygon = polygon;
  currentMinRating = minRating;
  applyFilters();
}

/**
 * Clears all markers from the map and resets sidebar.
 */
export function clearMarkers() {
  activeMarkers.forEach(({ marker }) => marker.setMap(null));
  activeMarkers = [];
  currentPlacesData = [];
  if (infoWindowInstance) infoWindowInstance.close();
  renderSidebar([]);
}

/**
 * Re-applies geometric and rating filters without re-fetching data.
 * @param {number} [newMinRating] 
 * @returns {Array<Object>} Filtered places
 */
export function applyFilters(newMinRating = null) {
  if (newMinRating !== null) {
    currentMinRating = newMinRating;
  }

  // Remove existing markers from map
  activeMarkers.forEach(({ marker }) => marker.setMap(null));
  activeMarkers = [];
  if (infoWindowInstance) infoWindowInstance.close();

  if (!currentPlacesData || currentPlacesData.length === 0 || !activePolygon) {
    renderSidebar([]);
    return [];
  }

  // 1. Geometric filter: points strictly inside polygon
  let filtered = currentPlacesData.filter(place => {
    if (!place.location) return false;
    const latLng = new google.maps.LatLng(place.location.latitude, place.location.longitude);
    return google.maps.geometry.poly.containsLocation(latLng, activePolygon);
  });

  // 2. Rating filter
  filtered = filtered.filter(place => (place.rating || 0) >= currentMinRating);

  // Render on map
  filtered.forEach(place => {
    const marker = createPlaceMarker(place);
    activeMarkers.push({ id: place.id, marker, data: place });
  });

  // Render in sidebar
  renderSidebar(filtered);

  return filtered;
}

/**
 * Builds photo URL from Places API response or fallback placeholder.
 * @param {Object} place 
 * @returns {string}
 */
export function getPhotoUrl(place) {
  if (place.photos && place.photos.length > 0 && currentApiKey) {
    return `https://places.googleapis.com/v1/${place.photos[0].name}/media?key=${currentApiKey}&maxHeightPx=300&maxWidthPx=480`;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80';
}

/**
 * Creates a modern Google Maps marker for a place.
 * @param {Object} place 
 * @returns {google.maps.Marker}
 */
function createPlaceMarker(place) {
  const position = { lat: place.location.latitude, lng: place.location.longitude };
  const title = place.displayName?.text || 'Place';

  const marker = new google.maps.Marker({
    map: mapInstance,
    position: position,
    title: title,
    animation: google.maps.Animation.DROP,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: '#4f46e5',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      labelOrigin: new google.maps.Point(0, 2.8)
    },
    label: {
      text: title.length > 22 ? title.substring(0, 20) + '…' : title,
      color: '#1e1b4b',
      fontSize: '11px',
      fontWeight: '700'
    }
  });

  marker.addListener('click', () => {
    openPlaceInfoWindow(place, marker);
    highlightSidebarCard(place.id);
  });

  return marker;
}

/**
 * Opens a rich InfoWindow for a specific place and marker.
 * @param {Object} place 
 * @param {google.maps.Marker} marker 
 */
export function openPlaceInfoWindow(place, marker) {
  if (!infoWindowInstance || !mapInstance) return;

  const photoUrl = getPhotoUrl(place);
  const title = place.displayName?.text || 'Place Details';
  const rating = place.rating ? place.rating.toFixed(1) : 'New';
  const ratingCount = place.userRatingCount ? `(${place.userRatingCount})` : '';
  const priceBadge = place.priceLevel && PRICE_SYMBOLS[place.priceLevel] ? PRICE_SYMBOLS[place.priceLevel] : '';
  
  let typeStr = (place.primaryType || '').replace(/_/g, ' ');
  if (typeStr) typeStr = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);

  const address = place.formattedAddress || 'Address not provided';
  const mapsUri = place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title + ' ' + address)}`;

  const content = `
    <div class="info-card">
      <img src="${photoUrl}" alt="${title}" class="info-card-img" onerror="this.src='https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80'">
      <div class="info-card-body">
        <h3 class="info-card-title">${title}</h3>
        <div class="info-card-meta">
          <span class="chip chip-rating">
            <span style="color: #f59e0b;">★</span> ${rating} ${ratingCount}
          </span>
          ${priceBadge ? `<span class="chip chip-price">${priceBadge}</span>` : ''}
        </div>
        ${typeStr ? `<p class="info-card-type">${typeStr}</p>` : ''}
        <p class="info-card-address">${address}</p>
        <a href="${mapsUri}" target="_blank" rel="noopener noreferrer" class="info-card-btn">
          <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          Open in Google Maps
        </a>
      </div>
    </div>
  `;

  infoWindowInstance.setContent(content);
  infoWindowInstance.open(mapInstance, marker);
}

/**
 * Focuses on a place by ID, centering map and opening info window.
 * @param {string} placeId 
 */
export function focusPlace(placeId) {
  const match = activeMarkers.find(m => m.id === placeId);
  if (!match || !mapInstance) return;

  mapInstance.panTo(match.marker.getPosition());
  openPlaceInfoWindow(match.data, match.marker);
  highlightSidebarCard(placeId);
}

/**
 * Highlights a place card in the sidebar.
 * @param {string} placeId 
 */
function highlightSidebarCard(placeId) {
  if (!sidebarListElement) return;

  const cards = sidebarListElement.querySelectorAll('.place-card');
  cards.forEach(c => {
    if (c.dataset.placeId === placeId) {
      c.classList.add('active');
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      c.classList.remove('active');
    }
  });
}

/**
 * Renders the place list into the sidebar container.
 * @param {Array<Object>} places 
 */
function renderSidebar(places) {
  if (sidebarCountElement) {
    sidebarCountElement.innerText = `${places.length} ${places.length === 1 ? 'place' : 'places'} found`;
  }

  if (!sidebarListElement) return;

  if (places.length === 0) {
    sidebarListElement.innerHTML = `
      <div class="flex flex-col items-center justify-center p-8 text-center text-gray-500 h-64">
        <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500 mb-3">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
        </div>
        <p class="font-semibold text-gray-700 text-sm">No places to display</p>
        <p class="text-xs text-gray-400 mt-1 max-w-xs">Draw an area on the map and enter what you're looking for to explore places.</p>
      </div>
    `;
    return;
  }

  sidebarListElement.innerHTML = places.map((place, idx) => {
    const photoUrl = getPhotoUrl(place);
    const title = place.displayName?.text || 'Place';
    const rating = place.rating ? place.rating.toFixed(1) : 'New';
    const ratingCount = place.userRatingCount ? `(${place.userRatingCount})` : '';
    const priceBadge = place.priceLevel && PRICE_SYMBOLS[place.priceLevel] ? PRICE_SYMBOLS[place.priceLevel] : '';
    
    let typeStr = (place.primaryType || '').replace(/_/g, ' ');
    if (typeStr) typeStr = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);

    const address = place.formattedAddress || 'Address not available';

    return `
      <div class="place-card p-3 mb-2 flex gap-3 items-center group cursor-pointer" data-place-id="${place.id}">
        <img src="${photoUrl}" alt="${title}" class="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-gray-100" onerror="this.src='https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80'">
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-1">
            <h4 class="font-bold text-sm text-gray-900 truncate group-hover:text-indigo-600 transition-colors">${title}</h4>
          </div>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs font-bold text-amber-600 flex items-center gap-0.5">
              <span>★</span> ${rating} <span class="text-[10px] font-normal text-gray-400">${ratingCount}</span>
            </span>
            ${priceBadge ? `<span class="text-xs text-gray-500 font-medium">${priceBadge}</span>` : ''}
            ${typeStr ? `<span class="text-[10px] text-gray-400 truncate uppercase tracking-wider font-semibold">${typeStr}</span>` : ''}
          </div>
          <p class="text-xs text-gray-500 truncate mt-1">${address}</p>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers on cards
  const cards = sidebarListElement.querySelectorAll('.place-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const placeId = card.dataset.placeId;
      focusPlace(placeId);
    });
  });
}
