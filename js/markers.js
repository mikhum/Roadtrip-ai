/**
 * AIRoadtrip — Markers, Popups & Sidebar Module (Leaflet Engine)
 * Manages custom map markers, glassmorphic popups, geometric polygon filtering,
 * rating filters, and bi-directional sidebar synchronization.
 */

import { isPointInPolygon } from './draw.js';

let mapInstance = null;
let activeMarkers = []; // Array of { id, marker, data }
let currentPlacesData = [];
let activePolygonCoords = null;
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
 * @param {L.Map} map 
 * @param {any} [infoWindow] 
 * @param {HTMLElement} listEl 
 * @param {HTMLElement} countEl 
 */
export function initMarkers(map, infoWindow, listEl, countEl) {
  mapInstance = map;
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
 * Sets the active places dataset and polygon coordinates, then applies filters.
 * @param {Array<Object>} places 
 * @param {Array<Object>|L.Polygon} polygon 
 * @param {number} minRating 
 */
export function setPlaces(places, polygon, minRating = 1.0) {
  currentPlacesData = places || [];
  activePolygonCoords = polygon;
  currentMinRating = minRating;
  applyFilters();
}

/**
 * Clears all markers from the map and resets sidebar.
 */
export function clearMarkers() {
  activeMarkers.forEach(({ marker }) => {
    if (mapInstance) mapInstance.removeLayer(marker);
  });
  activeMarkers = [];
  currentPlacesData = [];
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
  activeMarkers.forEach(({ marker }) => {
    if (mapInstance) mapInstance.removeLayer(marker);
  });
  activeMarkers = [];

  if (!currentPlacesData || currentPlacesData.length === 0) {
    renderSidebar([]);
    return [];
  }

  // 1. Geometric filter: points strictly inside polygon
  let filtered = currentPlacesData.filter(place => {
    if (!place.location) return false;
    const lat = place.location.latitude ?? place.location.lat;
    const lng = place.location.longitude ?? place.location.lng;
    return isPointInPolygon(lat, lng, activePolygonCoords);
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
  if (place.photoUrl) return place.photoUrl;
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80';
}

/**
 * Creates a Leaflet custom marker for a place.
 * @param {Object} place 
 * @returns {L.Marker}
 */
function createPlaceMarker(place) {
  const lat = place.location.latitude ?? place.location.lat;
  const lng = place.location.longitude ?? place.location.lng;
  const title = place.displayName?.text || place.name || 'Place';
  const rating = place.rating ? place.rating.toFixed(1) : '';

  const pinHtml = `
    <div class="custom-map-pin" data-id="${place.id}">
      <div class="pin-badge">
        <span>📍</span>
        <span>${title.length > 18 ? title.substring(0, 16) + '…' : title}</span>
        ${rating ? `<span class="bg-white/20 px-1 py-0.2 rounded text-[9px]">★${rating}</span>` : ''}
      </div>
    </div>
  `;

  const customIcon = L.divIcon({
    className: 'custom-map-pin-container',
    html: pinHtml,
    iconSize: [120, 30],
    iconAnchor: [60, 15]
  });

  const marker = L.marker([lat, lng], {
    icon: customIcon,
    title: title
  }).addTo(mapInstance);

  const popupHtml = buildPopupContent(place);
  marker.bindPopup(popupHtml, {
    maxWidth: 320,
    minWidth: 260,
    className: 'modern-place-popup'
  });

  marker.on('click', () => {
    highlightSidebarCard(place.id);
  });

  return marker;
}

/**
 * Builds HTML for rich place popup.
 * @param {Object} place 
 * @returns {string}
 */
function buildPopupContent(place) {
  const photoUrl = getPhotoUrl(place);
  const title = place.displayName?.text || place.name || 'Place Details';
  const rating = place.rating ? place.rating.toFixed(1) : 'New';
  const ratingCount = place.userRatingCount ? `(${place.userRatingCount})` : '';
  const priceBadge = place.priceLevel && PRICE_SYMBOLS[place.priceLevel] ? PRICE_SYMBOLS[place.priceLevel] : '';
  
  let typeStr = (place.primaryType || place.type || '').replace(/_/g, ' ');
  if (typeStr) typeStr = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);

  const address = place.formattedAddress || place.address || 'Address not provided';
  const mapsUri = place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title + ' ' + address)}`;

  return `
    <div class="info-card overflow-hidden rounded-xl">
      <img src="${photoUrl}" alt="${title}" class="w-full h-36 object-cover" onerror="this.src='https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80'">
      <div class="p-3.5 bg-white">
        <h3 class="font-bold text-sm text-slate-900 leading-tight mb-1">${title}</h3>
        <div class="flex items-center gap-2 mb-2">
          <span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-md border border-amber-200">
            <span>★</span> ${rating} <span class="text-[10px] text-amber-600 font-normal">${ratingCount}</span>
          </span>
          ${priceBadge ? `<span class="bg-slate-100 text-slate-700 text-xs font-semibold px-2 py-0.5 rounded-md">${priceBadge}</span>` : ''}
          ${typeStr ? `<span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">${typeStr}</span>` : ''}
        </div>
        <p class="text-xs text-slate-600 mb-3 line-clamp-2">${address}</p>
        <a href="${mapsUri}" target="_blank" rel="noopener noreferrer" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-1.5 px-3 text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          <span>Open in Google Maps</span>
        </a>
      </div>
    </div>
  `;
}

/**
 * Focuses on a place by ID, centering map and opening popup.
 * @param {string} placeId 
 */
export function focusPlace(placeId) {
  const match = activeMarkers.find(m => m.id === placeId);
  if (!match || !mapInstance) return;

  const latLng = match.marker.getLatLng();
  mapInstance.flyTo(latLng, Math.max(mapInstance.getZoom(), 14), { duration: 0.8 });
  match.marker.openPopup();
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
      c.classList.add('border-indigo-500', 'bg-indigo-50/50', 'ring-2', 'ring-indigo-100');
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      c.classList.remove('border-indigo-500', 'bg-indigo-50/50', 'ring-2', 'ring-indigo-100');
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
      <div class="flex flex-col items-center justify-center p-8 text-center text-slate-400 h-64">
        <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500 mb-3">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
        </div>
        <p class="font-semibold text-slate-700 text-sm">No places found in area</p>
        <p class="text-xs text-slate-400 mt-1 max-w-xs">Try searching for different terms or draw a larger search boundary.</p>
      </div>
    `;
    return;
  }

  sidebarListElement.innerHTML = places.map(place => {
    const photoUrl = getPhotoUrl(place);
    const title = place.displayName?.text || place.name || 'Place';
    const rating = place.rating ? place.rating.toFixed(1) : 'New';
    const ratingCount = place.userRatingCount ? `(${place.userRatingCount})` : '';
    const priceBadge = place.priceLevel && PRICE_SYMBOLS[place.priceLevel] ? PRICE_SYMBOLS[place.priceLevel] : '';
    
    let typeStr = (place.primaryType || place.type || '').replace(/_/g, ' ');
    if (typeStr) typeStr = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);

    const address = place.formattedAddress || place.address || 'Address not available';

    return `
      <div class="place-card p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md bg-white transition-all cursor-pointer flex gap-3 items-center group" data-place-id="${place.id}">
        <img src="${photoUrl}" alt="${title}" class="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-slate-100" onerror="this.src='https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80'">
        <div class="flex-1 min-w-0">
          <h4 class="font-bold text-xs text-slate-900 truncate group-hover:text-indigo-600 transition-colors">${title}</h4>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-xs font-bold text-amber-600 flex items-center gap-0.5">
              <span>★</span> ${rating} <span class="text-[10px] font-normal text-slate-400">${ratingCount}</span>
            </span>
            ${priceBadge ? `<span class="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.2 rounded">${priceBadge}</span>` : ''}
            ${typeStr ? `<span class="text-[9px] text-slate-400 truncate uppercase tracking-wider font-semibold">${typeStr}</span>` : ''}
          </div>
          <p class="text-[11px] text-slate-500 truncate mt-1">${address}</p>
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
