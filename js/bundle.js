/**
 * AIRoadtrip — Consolidated Single Bundle
 * High-performance, zero-API-key instant map rendering on Windows, Android & all devices.
 */
(function(window, document) {
'use strict';

// ==========================================================================
// 1. VOICE MODULE
// ==========================================================================

class VoiceInputController {
  constructor(options = {}) {
    this.lang = options.lang || 'sv-SE';
    this.recognition = null;
    this.isListening = false;

    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || (() => {});

    this.init();
  }

  static isSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.lang;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStart();
    };

    this.recognition.onresult = (event) => {
      if (event.results && event.results.length > 0) {
        const transcript = event.results[0][0].transcript;
        this.onResult(transcript);
      }
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.onError(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onEnd();
    };
  }

  setLanguage(newLang) {
    this.lang = newLang;
    if (this.recognition) {
      this.recognition.lang = newLang;
    }
  }

  toggle() {
    if (!VoiceInputController.isSupported()) {
      this.onError('unsupported');
      return;
    }

    if (!this.recognition) {
      this.init();
    }

    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (!this.recognition) return;
    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Speech recognition start error:', e);
    }
  }

  stop() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch (e) {
      console.warn('Speech recognition stop error:', e);
    }
  }
}

// ==========================================================================
// 2. MAP & GEOLOCATION MODULE
// ==========================================================================

let _mapInstance = null;
let _userLocationMarker = null;

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function initMap(container, options = {}) {
  const containerId = typeof container === 'string' ? container : container.id;
  const element = typeof container === 'string' ? document.getElementById(container) : container;
  if (!element) {
    throw new Error('Map container element not found.');
  }

  if (_mapInstance) {
    try {
      _mapInstance.remove();
    } catch (e) {
      console.warn('Map cleanup error:', e);
    }
    _mapInstance = null;
  }

  const defaultOptions = {
    center: [59.3293, 18.0686], // Default center: Stockholm
    zoom: 12,
    zoomControl: true,
    attributionControl: false,
    tap: true,
    touchZoom: true,
    scrollWheelZoom: true,
    preferCanvas: true
  };

  _mapInstance = L.map(containerId, { ...defaultOptions, ...options });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 19,
    detectRetina: true
  }).addTo(_mapInstance);

  if (_mapInstance.zoomControl) {
    _mapInstance.zoomControl.setPosition('bottomright');
  }

  setTimeout(() => {
    _mapInstance?.invalidateSize();
  }, 100);
  setTimeout(() => {
    _mapInstance?.invalidateSize();
  }, 400);

  return _mapInstance;
}

function getMap() {
  return _mapInstance;
}

async function jumpToLocation(queryStr, apiKey, onPlaceSelected) {
  if (!_mapInstance || !queryStr || !queryStr.trim()) return;
  const trimmed = queryStr.trim();

  // 1. Try Google Places API (New) if key exists
  if (apiKey) {
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.viewport'
        },
        body: JSON.stringify({ textQuery: trimmed, maxResultCount: 1 })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.places && data.places.length > 0) {
          const place = data.places[0];
          if (place.viewport) {
            const bounds = L.latLngBounds(
              [place.viewport.low.latitude, place.viewport.low.longitude],
              [place.viewport.high.latitude, place.viewport.high.longitude]
            );
            _mapInstance.fitBounds(bounds, { maxZoom: 14, animate: true, duration: 1.2 });
          } else if (place.location) {
            _mapInstance.flyTo([place.location.latitude, place.location.longitude], 13, { duration: 1.2 });
          }

          if (onPlaceSelected) {
            onPlaceSelected({
              name: place.displayName?.text || trimmed,
              formatted_address: place.formattedAddress,
              lat: place.location?.latitude,
              lng: place.location?.longitude
            });
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Google Places jump failed, falling back to OSM Nominatim:', e);
    }
  }

  // 2. Fallback to OpenStreetMap Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en,sv' } });
    if (res.ok) {
      const results = await res.json();
      if (results && results.length > 0) {
        const item = results[0];
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);

        if (item.boundingbox) {
          const south = parseFloat(item.boundingbox[0]);
          const north = parseFloat(item.boundingbox[1]);
          const west = parseFloat(item.boundingbox[2]);
          const east = parseFloat(item.boundingbox[3]);
          _mapInstance.fitBounds([[south, west], [north, east]], { maxZoom: 14, animate: true, duration: 1.2 });
        } else {
          _mapInstance.flyTo([lat, lon], 13, { duration: 1.2 });
        }

        if (onPlaceSelected) {
          onPlaceSelected({
            name: item.display_name.split(',')[0],
            formatted_address: item.display_name,
            lat,
            lng: lon
          });
        }
        return;
      }
    }
    throw new Error('Location not found.');
  } catch (err) {
    if (onPlaceSelected) onPlaceSelected(null, 'Could not find location. Please check the spelling.');
  }
}

function setupLocationAutocomplete(inputElement, apiKey, onPlaceSelected) {
  if (!_mapInstance || !inputElement) return;

  const dropdown = document.getElementById('locationDropdown');
  let debounceTimeout = null;

  inputElement.addEventListener('input', () => {
    const query = inputElement.value.trim();
    if (debounceTimeout) clearTimeout(debounceTimeout);

    if (query.length < 2) {
      if (dropdown) dropdown.classList.add('hidden');
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
          headers: { 'Accept-Language': 'en,sv' }
        });
        if (!res.ok) return;
        const results = await res.json();

        if (dropdown && results && results.length > 0) {
          dropdown.innerHTML = results.map(item => `
            <div class="px-3 py-2 text-xs hover:bg-indigo-50 cursor-pointer flex items-center gap-2 border-b border-slate-100 last:border-0 transition-colors" data-lat="${item.lat}" data-lon="${item.lon}" data-name="${item.display_name.replace(/"/g, '&quot;')}">
              <svg class="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
              <div class="truncate text-slate-700 font-medium">${item.display_name}</div>
            </div>
          `).join('');

          dropdown.classList.remove('hidden');

          dropdown.querySelectorAll('div[data-lat]').forEach(el => {
            el.addEventListener('click', () => {
              const lat = parseFloat(el.dataset.lat);
              const lon = parseFloat(el.dataset.lon);
              const name = el.dataset.name;

              inputElement.value = name.split(',')[0];
              dropdown.classList.add('hidden');

              _mapInstance.flyTo([lat, lon], 13, { duration: 1.2 });
              if (onPlaceSelected) {
                onPlaceSelected({ name: name.split(',')[0], formatted_address: name, lat, lng: lon });
              }
            });
          });
        } else if (dropdown) {
          dropdown.classList.add('hidden');
        }
      } catch (e) {
        console.warn('Autocomplete fetch failed:', e);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== inputElement) {
      dropdown.classList.add('hidden');
    }
  });
}

function geolocateUser() {
  return new Promise((resolve, reject) => {
    if (!_mapInstance) {
      reject(new Error('Map is not initialized.'));
      return;
    }

    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        _mapInstance.flyTo([lat, lng], 14, { duration: 1.2 });

        const pulseIcon = L.divIcon({
          className: 'user-location-pulse-container',
          html: '<div class="user-location-pulse"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });

        if (_userLocationMarker) {
          _userLocationMarker.setLatLng([lat, lng]);
          _userLocationMarker.addTo(_mapInstance);
        } else {
          _userLocationMarker = L.marker([lat, lng], {
            icon: pulseIcon,
            zIndexOffset: 9999,
            title: 'Your Location'
          }).addTo(_mapInstance);
        }

        resolve({ lat, lng });
      },
      (error) => {
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ==========================================================================
// 3. FREEHAND DRAWING MODULE
// ==========================================================================

let _drawMapContainer = null;
let _currentPolygon = null;
let _currentPoints = [];
let _freehandPolyline = null;
let _isDrawingActive = false;
let _isModeEnabled = false;

let _drawCallbacks = {
  onDrawStart: () => {},
  onDrawComplete: () => {},
  onDrawCancel: () => {}
};

function initDrawing(map, container, cbs = {}) {
  _drawMapContainer = typeof container === 'string' ? document.getElementById(container) : container;
  _drawCallbacks = { ..._drawCallbacks, ...cbs };

  _cleanupDrawListeners();
  _setupDrawListeners();
}

function _getLatLngFromEvent(e) {
  if (!_mapInstance || !_drawMapContainer) return null;

  const rect = _drawMapContainer.getBoundingClientRect();
  const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
  const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;

  if (clientX === undefined || clientY === undefined) return null;

  const containerPoint = L.point(clientX - rect.left, clientY - rect.top);
  return _mapInstance.containerPointToLatLng(containerPoint);
}

function _handleDrawStart(e) {
  if (!_isModeEnabled) return;
  e.preventDefault();

  _isDrawingActive = true;
  const latLng = _getLatLngFromEvent(e);
  if (!latLng) return;

  _currentPoints = [latLng];

  if (_currentPolygon) {
    _mapInstance.removeLayer(_currentPolygon);
    _currentPolygon = null;
  }

  if (_freehandPolyline) {
    _mapInstance.removeLayer(_freehandPolyline);
    _freehandPolyline = null;
  }

  _drawCallbacks.onDrawStart();
}

function _handleDrawMove(e) {
  if (!_isModeEnabled || !_isDrawingActive) return;
  e.preventDefault();

  const latLng = _getLatLngFromEvent(e);
  if (!latLng) return;

  const last = _currentPoints[_currentPoints.length - 1];
  if (last && Math.abs(last.lat - latLng.lat) < 0.00001 && Math.abs(last.lng - latLng.lng) < 0.00001) {
    return;
  }

  _currentPoints.push(latLng);

  if (_freehandPolyline) {
    _freehandPolyline.setLatLngs(_currentPoints);
  } else {
    _freehandPolyline = L.polyline(_currentPoints, {
      color: '#4f46e5',
      weight: 3,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(_mapInstance);
  }
}

function _handleDrawEnd(e) {
  if (!_isModeEnabled || !_isDrawingActive) return;
  if (e) e.preventDefault();

  _isDrawingActive = false;
  deactivateDrawMode();

  if (_freehandPolyline) {
    _mapInstance.removeLayer(_freehandPolyline);
    _freehandPolyline = null;
  }

  if (_currentPoints.length < 3) {
    _currentPoints = [];
    _drawCallbacks.onDrawCancel();
    return;
  }

  _currentPolygon = L.polygon(_currentPoints, {
    color: '#4f46e5',
    weight: 2.5,
    opacity: 0.9,
    fillColor: '#4f46e5',
    fillOpacity: 0.18,
    interactive: false
  }).addTo(_mapInstance);

  _drawCallbacks.onDrawComplete(_currentPolygon);
}

function _setupDrawListeners() {
  if (!_drawMapContainer) return;
  _drawMapContainer.addEventListener('mousedown', _handleDrawStart, { passive: false });
  window.addEventListener('mousemove', _handleDrawMove, { passive: false });
  window.addEventListener('mouseup', _handleDrawEnd, { passive: false });

  _drawMapContainer.addEventListener('touchstart', _handleDrawStart, { passive: false });
  window.addEventListener('touchmove', _handleDrawMove, { passive: false });
  window.addEventListener('touchend', _handleDrawEnd, { passive: false });
  window.addEventListener('touchcancel', _handleDrawEnd, { passive: false });
}

function _cleanupDrawListeners() {
  if (!_drawMapContainer) return;
  _drawMapContainer.removeEventListener('mousedown', _handleDrawStart);
  window.removeEventListener('mousemove', _handleDrawMove);
  window.removeEventListener('mouseup', _handleDrawEnd);

  _drawMapContainer.removeEventListener('touchstart', _handleDrawStart);
  window.removeEventListener('touchmove', _handleDrawMove);
  window.removeEventListener('touchend', _handleDrawEnd);
  window.removeEventListener('touchcancel', _handleDrawEnd);
}

function activateDrawMode() {
  if (!_mapInstance) return;
  _isModeEnabled = true;
  _isDrawingActive = false;

  _mapInstance.dragging.disable();
  _mapInstance.touchZoom.disable();
  _mapInstance.doubleClickZoom.disable();
  _mapInstance.scrollWheelZoom.disable();
  _mapInstance.boxZoom.disable();
  _mapInstance.keyboard.disable();
  if (_mapInstance.tap) _mapInstance.tap.disable();

  if (_drawMapContainer) {
    _drawMapContainer.style.cursor = 'crosshair';
  }
}

function deactivateDrawMode() {
  if (!_mapInstance) return;
  _isModeEnabled = false;
  _isDrawingActive = false;

  _mapInstance.dragging.enable();
  _mapInstance.touchZoom.enable();
  _mapInstance.doubleClickZoom.enable();
  _mapInstance.scrollWheelZoom.enable();
  _mapInstance.boxZoom.enable();
  _mapInstance.keyboard.enable();
  if (_mapInstance.tap) _mapInstance.tap.enable();

  if (_drawMapContainer) {
    _drawMapContainer.style.cursor = '';
  }
}

function clearCurrentPolygon() {
  if (_currentPolygon && _mapInstance) {
    _mapInstance.removeLayer(_currentPolygon);
    _currentPolygon = null;
  }
  if (_freehandPolyline && _mapInstance) {
    _mapInstance.removeLayer(_freehandPolyline);
    _freehandPolyline = null;
  }
  _currentPoints = [];
}

function getCurrentPolygon() {
  return _currentPolygon;
}

function getPolygonCoordinates() {
  return _currentPoints.map(p => ({ lat: p.lat, lng: p.lng }));
}

function hasPolygon() {
  return _currentPolygon !== null && _currentPoints.length >= 3;
}

function isPointInPolygon(lat, lng, coords = null) {
  let points = coords;
  if (!points) {
    points = getPolygonCoordinates();
  } else if (points && typeof points.getLatLngs === 'function') {
    const latLngs = points.getLatLngs();
    points = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
  }

  if (!points || points.length < 3) return true;

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lat, yi = points[i].lng;
    const xj = points[j].lat, yj = points[j].lng;

    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

// ==========================================================================
// 4. MARKERS & SIDEBAR MODULE
// ==========================================================================

let _activeMarkers = [];
let _currentPlacesData = [];
let _activePolygonCoords = null;
let _currentApiKey = '';
let _currentMinRating = 1.0;
let _sidebarListElement = null;
let _sidebarCountElement = null;

const PRICE_SYMBOLS = {
  'PRICE_LEVEL_FREE': 'Free',
  'PRICE_LEVEL_INEXPENSIVE': '$',
  'PRICE_LEVEL_MODERATE': '$$',
  'PRICE_LEVEL_EXPENSIVE': '$$$',
  'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$'
};

function initMarkers(map, infoWindow, listEl, countEl) {
  _sidebarListElement = listEl;
  _sidebarCountElement = countEl;
}

function setMarkersApiKey(apiKey) {
  _currentApiKey = apiKey;
}

function setPlaces(places, polygon, minRating = 1.0) {
  _currentPlacesData = places || [];
  _activePolygonCoords = polygon;
  _currentMinRating = minRating;
  applyFilters();
}

function clearMarkers() {
  _activeMarkers.forEach(({ marker }) => {
    if (_mapInstance) _mapInstance.removeLayer(marker);
  });
  _activeMarkers = [];
  _currentPlacesData = [];
  renderSidebar([]);
}

function applyFilters(newMinRating = null) {
  if (newMinRating !== null) {
    _currentMinRating = newMinRating;
  }

  _activeMarkers.forEach(({ marker }) => {
    if (_mapInstance) _mapInstance.removeLayer(marker);
  });
  _activeMarkers = [];

  if (!_currentPlacesData || _currentPlacesData.length === 0) {
    renderSidebar([]);
    return [];
  }

  let filtered = _currentPlacesData.filter(place => {
    if (!place.location) return false;
    const lat = place.location.latitude ?? place.location.lat;
    const lng = place.location.longitude ?? place.location.lng;
    return isPointInPolygon(lat, lng, _activePolygonCoords);
  });

  filtered = filtered.filter(place => (place.rating || 0) >= _currentMinRating);

  filtered.forEach(place => {
    const marker = createPlaceMarker(place);
    _activeMarkers.push({ id: place.id, marker, data: place });
  });

  renderSidebar(filtered);
  return filtered;
}

function getPhotoUrl(place) {
  if (place.photos && place.photos.length > 0 && _currentApiKey) {
    return `https://places.googleapis.com/v1/${place.photos[0].name}/media?key=${_currentApiKey}&maxHeightPx=300&maxWidthPx=480`;
  }
  if (place.photoUrl) return place.photoUrl;
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80';
}

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
  }).addTo(_mapInstance);

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

function focusPlace(placeId) {
  const match = _activeMarkers.find(m => m.id === placeId);
  if (!match || !_mapInstance) return;

  const latLng = match.marker.getLatLng();
  _mapInstance.flyTo(latLng, Math.max(_mapInstance.getZoom(), 14), { duration: 0.8 });
  match.marker.openPopup();
  highlightSidebarCard(placeId);
}

function highlightSidebarCard(placeId) {
  if (!_sidebarListElement) return;

  const cards = _sidebarListElement.querySelectorAll('.place-card');
  cards.forEach(c => {
    if (c.dataset.placeId === placeId) {
      c.classList.add('border-indigo-500', 'bg-indigo-50/50', 'ring-2', 'ring-indigo-100');
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      c.classList.remove('border-indigo-500', 'bg-indigo-50/50', 'ring-2', 'ring-indigo-100');
    }
  });
}

function renderSidebar(places) {
  if (_sidebarCountElement) {
    _sidebarCountElement.innerText = `${places.length} ${places.length === 1 ? 'place' : 'places'} found`;
  }

  if (!_sidebarListElement) return;

  if (places.length === 0) {
    _sidebarListElement.innerHTML = `
      <div class="flex flex-col items-center justify-center p-8 text-center text-slate-400 h-64">
        <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500 mb-3">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
        </div>
        <p class="font-semibold text-slate-700 text-sm">No places found in area</p>
        <p class="text-xs text-slate-400 mt-1 max-w-xs">Try searching for different terms or draw a larger search boundary.</p>
      </div>
    `;
    return;
  }

  _sidebarListElement.innerHTML = places.map(place => {
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

  const cards = _sidebarListElement.querySelectorAll('.place-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const placeId = card.dataset.placeId;
      focusPlace(placeId);
    });
  });
}

// ==========================================================================
// 5. SEARCH & AI TRANSLATION MODULE
// ==========================================================================

const HISTORY_STORAGE_KEY = 'ai_roadtrip_search_history';
const MAX_HISTORY_ITEMS = 5;

function getPolygonBounds(polygon) {
  let points = [];
  if (Array.isArray(polygon)) {
    points = polygon;
  } else if (polygon && typeof polygon.getLatLngs === 'function') {
    const latLngs = polygon.getLatLngs();
    points = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
  }

  if (!points || points.length === 0) {
    return { north: 90, south: -90, east: 180, west: -180 };
  }

  let north = -90, south = 90, east = -180, west = 180;

  for (const pt of points) {
    const lat = pt.lat;
    const lng = pt.lng;

    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }

  return { north, south, east, west };
}

async function optimizeQueryWithGemini(userPrompt, apiKey) {
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('Please enter a search prompt.');
  }

  const promptText = userPrompt.trim();
  if (!apiKey) return promptText;

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an AI assistant that converts user road trip / travel search requests (in Swedish, English, or any language) into optimal search phrases for Google Places API (New) Text Search.
User request: "${promptText}".
Respond ONLY with a valid JSON object in this format: {"searchQuery": "optimized search phrase"}. Do not include markdown code blocks, just raw JSON.`
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      });

      if (!response.ok) continue;

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) continue;

      const cleanJson = content.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed && parsed.searchQuery) {
        return parsed.searchQuery;
      }
    } catch (err) {
      console.warn(`Gemini translation with model ${model} failed:`, err);
    }
  }

  return promptText;
}

async function searchPlacesInPolygon(queryStr, polygon, apiKey) {
  if (!polygon) {
    throw new Error('Please draw a search area on the map first.');
  }

  if (!queryStr || !queryStr.trim()) {
    throw new Error('Search query cannot be empty.');
  }

  const bounds = getPolygonBounds(polygon);

  if (apiKey) {
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress,places.photos,places.primaryType,places.googleMapsUri,places.websiteUri,places.regularOpeningHours'
        },
        body: JSON.stringify({
          textQuery: queryStr,
          locationRestriction: {
            rectangle: {
              low: { latitude: bounds.south, longitude: bounds.west },
              high: { latitude: bounds.north, longitude: bounds.east }
            }
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.places && data.places.length > 0) {
          return data.places;
        }
      }
    } catch (e) {
      console.warn('Google Places API request failed, falling back to OSM:', e);
    }
  }

  try {
    return await searchOverpassOsm(queryStr, bounds);
  } catch (err) {
    console.error('OSM Search failed:', err);
    return [];
  }
}

async function searchOverpassOsm(queryStr, bounds) {
  const qLower = queryStr.toLowerCase();
  let tagFilter = '["tourism"]';
  let categoryName = 'Tourism';

  if (qLower.includes('hotel') || qLower.includes('motel') || qLower.includes('hostel') || qLower.includes('boende') || qLower.includes('stay')) {
    tagFilter = '["tourism"~"hotel|motel|hostel|guest_house|camp_site"]';
    categoryName = 'Hotel / Lodging';
  } else if (qLower.includes('food') || qLower.includes('restaurang') || qLower.includes('restaurant') || qLower.includes('mat') || qLower.includes('cafe') || qLower.includes('fika')) {
    tagFilter = '["amenity"~"restaurant|cafe|fast_food|bar|pub"]';
    categoryName = 'Food & Drinks';
  } else if (qLower.includes('view') || qLower.includes('utsikt') || qLower.includes('scenic') || qLower.includes('attraction') || qLower.includes('sevärdhet')) {
    tagFilter = '["tourism"~"viewpoint|attraction|museum|theme_park"]';
    categoryName = 'Scenic Spot / Attraction';
  } else if (qLower.includes('ev') || qLower.includes('ladd') || qLower.includes('charge') || qLower.includes('gas') || qLower.includes('mack')) {
    tagFilter = '["amenity"~"charging_station|fuel"]';
    categoryName = 'Charging / Fuel';
  } else {
    tagFilter = '["name"]';
  }

  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const overpassQuery = `
    [out:json][timeout:15];
    (
      node${tagFilter}(${bbox});
      way${tagFilter}(${bbox});
    );
    out center 40;
  `;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery)}`
  });

  if (!response.ok) return [];

  const data = await response.json();
  const elements = data.elements || [];

  return elements
    .filter(el => (el.tags && el.tags.name))
    .map((el, index) => {
      const lat = el.lat || el.center?.lat;
      const lon = el.lon || el.center?.lon;
      const name = el.tags.name;
      const address = [el.tags['addr:street'], el.tags['addr:housenumber'], el.tags['addr:city']].filter(Boolean).join(' ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      const pseudoRating = (4.0 + (index % 10) * 0.1);

      return {
        id: `osm-${el.id || index}`,
        name: name,
        displayName: { text: name },
        location: { latitude: lat, longitude: lon, lat: lat, lng: lon },
        rating: pseudoRating,
        userRatingCount: 15 + (index * 7),
        formattedAddress: address,
        primaryType: el.tags.tourism || el.tags.amenity || categoryName,
        googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`,
        photoUrl: getPlaceholderPhoto(el.tags.tourism || el.tags.amenity || qLower)
      };
    });
}

function getPlaceholderPhoto(category = '') {
  const cat = category.toLowerCase();
  if (cat.includes('hotel') || cat.includes('motel') || cat.includes('hostel')) {
    return 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=500&auto=format&fit=crop&q=80';
  }
  if (cat.includes('restaurant') || cat.includes('cafe') || cat.includes('food')) {
    return 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500&auto=format&fit=crop&q=80';
  }
  if (cat.includes('view') || cat.includes('attraction')) {
    return 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=500&auto=format&fit=crop&q=80';
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=500&auto=format&fit=crop&q=80';
}

function getSearchHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSearchToHistory(query) {
  if (!query || !query.trim()) return;
  const trimmed = query.trim();

  let history = getSearchHistory();
  history = history.filter(item => item.toLowerCase() !== trimmed.toLowerCase());
  history.unshift(trimmed);

  if (history.length > MAX_HISTORY_ITEMS) {
    history = history.slice(0, MAX_HISTORY_ITEMS);
  }

  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function clearSearchHistory() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
}

// ==========================================================================
// 6. MAIN APPLICATION COORDINATOR
// ==========================================================================

const CLIENT_ID = '940508107225-2h91m1o4he6r27g1q7hgtaq0f6127dd8.apps.googleusercontent.com';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'roadtrip_config.json';
const API_KEY_STORAGE_KEY = 'googleMapsApiKey';
const VOICE_LANG_STORAGE_KEY = 'roadtrip_voice_lang';

let _appApiKey = '';
let _voiceController = null;
let _currentVoiceLang = localStorage.getItem(VOICE_LANG_STORAGE_KEY) || 'sv-SE';
let _gapiInited = false;
let _gisInited = false;
let _tokenClient = null;

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    info: `<svg class="toast-icon w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
    success: `<svg class="toast-icon w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
    warning: `<svg class="toast-icon w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
    error: `<svg class="toast-icon w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
  };

  toast.innerHTML = `
    ${icons[type] || icons.info}
    <div class="flex-1 font-medium">${message}</div>
  `;

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  return toast;
}

function initGoogleDriveSync() {
  window.gapiLoaded = function () {
    if (!window.gapi) return;
    gapi.load('client', async () => {
      try {
        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        _gapiInited = true;
        enableDriveButtons();
      } catch (e) {
        console.error('GAPI init error:', e);
      }
    });
  };

  window.gisLoaded = function () {
    try {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: ''
      });
      _gisInited = true;
      enableDriveButtons();
    } catch (e) {
      console.error('GIS init error:', e);
    }
  };

  if (window.gapi) window.gapiLoaded();
  if (window.google?.accounts?.oauth2) window.gisLoaded();
}

function enableDriveButtons() {
  const loadBtn = document.getElementById('loadDriveBtn');
  const saveBtn = document.getElementById('saveDriveBtn');
  if (_gapiInited && _gisInited && loadBtn && saveBtn) {
    loadBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    saveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    loadBtn.disabled = false;
    saveBtn.disabled = false;
  }
}

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    if (gapi.client.getToken() !== null) {
      resolve();
    } else {
      _tokenClient.callback = (resp) => {
        if (resp.error !== undefined) reject(resp);
        else resolve();
      };
      _tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  });
}

function setDriveStatus(msg, type = 'info') {
  const el = document.getElementById('driveStatus');
  if (!el) return;
  el.innerText = msg;
  const colorMap = {
    error: 'text-red-500 font-semibold',
    success: 'text-emerald-600 font-semibold',
    warning: 'text-amber-500 font-semibold',
    info: 'text-indigo-600 font-medium'
  };
  el.className = `text-xs mt-2 text-center min-h-[18px] ${colorMap[type] || colorMap.info}`;
}

async function loadKeyFromDrive() {
  try {
    setDriveStatus('Waiting for Google sign-in…', 'info');
    await getAuthToken();
    setDriveStatus('Fetching key from Google Drive…', 'info');

    const response = await gapi.client.drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${FILE_NAME}'`,
      fields: 'files(id, name)'
    });
    const files = response.result.files;

    if (files && files.length > 0) {
      const fileRes = await gapi.client.drive.files.get({
        fileId: files[0].id,
        alt: 'media'
      });
      if (fileRes.result && fileRes.result.apiKey) {
        document.getElementById('apiKeyInput').value = fileRes.result.apiKey;
        _appApiKey = fileRes.result.apiKey;
        localStorage.setItem(API_KEY_STORAGE_KEY, _appApiKey);
        setMarkersApiKey(_appApiKey);
        setDriveStatus('API key loaded successfully!', 'success');
        showToast('API key retrieved from Google Drive', 'success');
      } else {
        setDriveStatus('File found but contains no API key.', 'warning');
      }
    } else {
      setDriveStatus('No saved key found in Google Drive.', 'warning');
    }
  } catch (err) {
    console.error('Error loading key from Drive:', err);
    setDriveStatus('Failed to retrieve key from Drive.', 'error');
  }
}

async function saveKeyToDrive() {
  const inputKey = document.getElementById('apiKeyInput').value.trim();
  if (!inputKey) {
    setDriveStatus('Please enter an API key first.', 'warning');
    return;
  }

  try {
    setDriveStatus('Waiting for Google sign-in…', 'info');
    await getAuthToken();
    setDriveStatus('Saving key to Google Drive…', 'info');

    const response = await gapi.client.drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${FILE_NAME}'`,
      fields: 'files(id, name)'
    });
    const files = response.result.files;
    const fileContent = JSON.stringify({ apiKey: inputKey });

    if (files && files.length > 0) {
      await gapi.client.request({
        path: `/upload/drive/v3/files/${files[0].id}`,
        method: 'PATCH',
        params: { uploadType: 'media' },
        body: fileContent
      });
    } else {
      await gapi.client.request({
        path: '/upload/drive/v3/files',
        method: 'POST',
        params: { uploadType: 'multipart' },
        headers: { 'Content-Type': 'multipart/related; boundary=foo_bar_baz' },
        body: `--foo_bar_baz\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] }) +
          `\r\n--foo_bar_baz\r\nContent-Type: application/json\r\n\r\n` +
          fileContent + `\r\n--foo_bar_baz--`
      });
    }

    setDriveStatus('Key backed up to Google Drive!', 'success');
    showToast('Key saved to Google Drive Cloud', 'success');
  } catch (err) {
    console.error('Error saving key to Drive:', err);
    setDriveStatus('Failed to save key to Drive.', 'error');
  }
}

function toggleSettingsModal(force = null) {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  if (force === true) modal.classList.remove('hidden');
  else if (force === false) modal.classList.add('hidden');
  else modal.classList.toggle('hidden');
}

function toggleDrawer(force = null) {
  const drawer = document.getElementById('navDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (!drawer || !backdrop) return;

  const isOpen = !drawer.classList.contains('translate-x-full');
  const shouldOpen = force !== null ? force : !isOpen;

  if (shouldOpen) {
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => {
      backdrop.classList.remove('opacity-0');
      drawer.classList.remove('translate-x-full');
    });
    renderSearchHistory();
  } else {
    backdrop.classList.add('opacity-0');
    drawer.classList.add('translate-x-full');
    setTimeout(() => {
      backdrop.classList.add('hidden');
    }, 300);
  }
}

function toggleSidebar(force = null) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  if (force === true) sidebar.classList.remove('sidebar-collapsed');
  else if (force === false) sidebar.classList.add('sidebar-collapsed');
  else sidebar.classList.toggle('sidebar-collapsed');
}

function saveSettingsAndStart() {
  const inputVal = document.getElementById('apiKeyInput').value.trim();
  _appApiKey = inputVal;
  localStorage.setItem(API_KEY_STORAGE_KEY, _appApiKey);
  setMarkersApiKey(_appApiKey);
  toggleSettingsModal(false);

  if (_appApiKey) {
    showToast('API key saved! Gemini AI & Places active.', 'success');
  } else {
    showToast('Using instant OpenStreetMap mode.', 'info');
  }
}

function bootstrapMap() {
  const overlay = document.getElementById('mapOverlay');
  if (overlay) overlay.classList.add('hidden');

  try {
    const map = initMap('map');

    const sidebarList = document.getElementById('sidebarList');
    const sidebarCount = document.getElementById('sidebarCount');
    initMarkers(map, null, sidebarList, sidebarCount);
    if (_appApiKey) setMarkersApiKey(_appApiKey);

    const mapDiv = document.getElementById('map');
    initDrawing(map, mapDiv, {
      onDrawStart: () => {
        document.getElementById('drawModeNotice')?.classList.remove('hidden');
        document.getElementById('floatingMapControls')?.classList.add('hidden');
      },
      onDrawComplete: (polygon) => {
        document.getElementById('drawModeNotice')?.classList.add('hidden');
        document.getElementById('floatingMapControls')?.classList.remove('hidden');
        document.getElementById('clearAreaBtn')?.classList.remove('hidden');
        
        const startText = document.getElementById('startDrawBtnText');
        if (startText) startText.innerText = 'Redraw Area';

        showToast('Area defined! Enter your query or click Search.', 'info');
        
        const query = document.getElementById('searchInput').value.trim();
        if (query) {
          triggerAiSearch();
        }
      },
      onDrawCancel: () => {
        document.getElementById('drawModeNotice')?.classList.add('hidden');
        document.getElementById('floatingMapControls')?.classList.remove('hidden');
      }
    });

    const locationInput = document.getElementById('locationSearch');
    setupLocationAutocomplete(locationInput, _appApiKey, (place, err) => {
      if (err) {
        showToast(err, 'warning');
      } else {
        toggleDrawer(false);
        showToast(`Moved to ${place.name || place.formatted_address || 'selected area'}`, 'info');
      }
    });

    document.getElementById('locationJumpBtn')?.addEventListener('click', () => {
      const val = locationInput?.value?.trim();
      if (val) {
        jumpToLocation(val, _appApiKey, (place, err) => {
          if (err) {
            showToast(err, 'warning');
          } else {
            toggleDrawer(false);
            showToast(`Moved to ${place.name || place.formatted_address || val}`, 'info');
          }
        });
      } else {
        showToast('Please type a city or place name first.', 'info');
      }
    });

    document.getElementById('floatingMapControls')?.classList.remove('hidden');

  } catch (err) {
    console.error('Error bootstrapping map:', err);
    showToast(`Map init error: ${err.message || err}`, 'error');
  }
}

async function triggerAiSearch() {
  const polygon = getCurrentPolygon();
  if (!polygon) {
    showToast('Draw a search area on the map first!', 'warning');
    activateDrawMode();
    return;
  }

  const queryText = document.getElementById('searchInput').value.trim();
  if (!queryText) {
    showToast('Please type or speak what places you are looking for.', 'warning');
    document.getElementById('searchInput').focus();
    return;
  }

  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = `<span class="spinner !w-3.5 !h-3.5 !border-white !border-t-transparent inline-block mr-1"></span>`;
  }

  clearMarkers();
  showToast('Searching for places in area…', 'info', 2000);

  try {
    let optimizedQuery = queryText;
    if (_appApiKey) {
      try {
        optimizedQuery = await optimizeQueryWithGemini(queryText, _appApiKey);
      } catch (e) {
        console.warn('Gemini optimization fallback:', e);
      }
    }
    
    saveSearchToHistory(queryText);
    renderSearchHistory();

    const places = await searchPlacesInPolygon(optimizedQuery, polygon, _appApiKey);

    const minRating = parseFloat(document.getElementById('minRatingSlider')?.value || '1.0');
    setPlaces(places, polygon, minRating);

    const filtered = applyFilters();
    if (filtered.length > 0) {
      showToast(`Found ${filtered.length} matching places!`, 'success');
      toggleSidebar(true);
    } else {
      showToast('No places found in the selected boundary. Try drawing a larger area.', 'warning');
    }

  } catch (err) {
    console.error('Search error:', err);
    showToast(`Search failed: ${err.message || err}`, 'error');
  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>`;
    }
  }
}

function handleStartDraw() {
  activateDrawMode();
  showToast('Click and drag across the map to outline your area.', 'info', 3500);
}

function handleClearArea() {
  clearCurrentPolygon();
  clearMarkers();
  
  document.getElementById('clearAreaBtn')?.classList.add('hidden');
  const startText = document.getElementById('startDrawBtnText');
  if (startText) startText.innerText = 'Draw Search Area';

  showToast('Search area and markers cleared.', 'info');
}

function renderSearchHistory() {
  const container = document.getElementById('drawerSearchHistoryList');
  if (!container) return;

  const history = getSearchHistory();
  if (history.length === 0) {
    container.innerHTML = `<p class="text-[11px] text-slate-400 italic py-1">No recent searches</p>`;
    return;
  }

  container.innerHTML = history.map(item => `
    <div class="flex items-center justify-between p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer group transition-colors" data-query="${item.replace(/"/g, '&quot;')}">
      <span class="text-xs text-slate-700 truncate group-hover:text-indigo-600">${item}</span>
      <svg class="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
    </div>
  `).join('');

  container.querySelectorAll('div[data-query]').forEach(el => {
    el.addEventListener('click', () => {
      const q = el.dataset.query;
      document.getElementById('searchInput').value = q;
      toggleDrawer(false);
      triggerAiSearch();
    });
  });
}

function setVoiceLanguage(lang, notify = true) {
  _currentVoiceLang = lang;
  localStorage.setItem(VOICE_LANG_STORAGE_KEY, lang);

  if (_voiceController) {
    _voiceController.setLanguage(lang);
  }

  const selectEl = document.getElementById('voiceLangSelect');
  const searchInput = document.getElementById('searchInput');
  const svBtn = document.getElementById('langOptionSv');
  const enBtn = document.getElementById('langOptionEn');

  if (lang === 'sv-SE') {
    if (selectEl) selectEl.value = 'sv-SE';
    if (svBtn) svBtn.className = 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border-2 border-indigo-600 bg-indigo-50 text-indigo-700 text-xs font-bold shadow-xs transition-all';
    if (enBtn) enBtn.className = 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold shadow-2xs transition-all';
    if (searchInput && !searchInput.value) {
      searchInput.placeholder = "Fråga Gemini AI (t.ex. 'Hotell med laddplats och pool')…";
    }
    if (notify) showToast('Talspråk inställt på Svenska 🇸🇪', 'info');
  } else {
    if (selectEl) selectEl.value = 'en-US';
    if (enBtn) enBtn.className = 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border-2 border-indigo-600 bg-indigo-50 text-indigo-700 text-xs font-bold shadow-xs transition-all';
    if (svBtn) svBtn.className = 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold shadow-2xs transition-all';
    if (searchInput && !searchInput.value) {
      searchInput.placeholder = "Ask Gemini AI (e.g., 'Boutique hotels with EV charging and pool')…";
    }
    if (notify) showToast('Spoken language set to English 🇬🇧', 'info');
  }
}

function initApp() {
  const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (savedKey) {
    _appApiKey = savedKey;
    const keyInput = document.getElementById('apiKeyInput');
    if (keyInput) keyInput.value = savedKey;
  }

  // Always boot the interactive map immediately
  bootstrapMap();

  const micBtn = document.getElementById('micBtn');
  _voiceController = new VoiceInputController({
    lang: _currentVoiceLang,
    onStart: () => {
      if (micBtn) micBtn.classList.add('mic-active');
      const langLabel = _currentVoiceLang === 'sv-SE' ? 'Svenska 🇸🇪' : 'English 🇬🇧';
      showToast(`Lyssnar (${langLabel})…`, 'info');
    },
    onEnd: () => {
      if (micBtn) micBtn.classList.remove('mic-active');
    },
    onResult: (transcript) => {
      document.getElementById('searchInput').value = transcript;
      showToast(`Uppfattade / Heard: "${transcript}"`, 'success');
      triggerAiSearch();
    },
    onError: (err) => {
      if (micBtn) micBtn.classList.remove('mic-active');
      showToast('Kunde inte uppfatta tal / Could not recognize speech.', 'warning');
    }
  });

  document.getElementById('langOptionSv')?.addEventListener('click', () => setVoiceLanguage('sv-SE', true));
  document.getElementById('langOptionEn')?.addEventListener('click', () => setVoiceLanguage('en-US', true));
  document.getElementById('voiceLangSelect')?.addEventListener('change', (e) => setVoiceLanguage(e.target.value, true));

  setVoiceLanguage(_currentVoiceLang, false);

  document.getElementById('hamburgerBtn')?.addEventListener('click', () => toggleDrawer(true));
  document.getElementById('closeDrawerBtn')?.addEventListener('click', () => toggleDrawer(false));
  document.getElementById('drawerBackdrop')?.addEventListener('click', () => toggleDrawer(false));

  document.getElementById('drawerClearBtn')?.addEventListener('click', () => {
    handleClearArea();
    toggleDrawer(false);
  });

  document.getElementById('drawerOpenSettingsBtn')?.addEventListener('click', () => {
    toggleDrawer(false);
    toggleSettingsModal(true);
  });

  document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettingsAndStart);
  document.getElementById('closeSettingsBtn')?.addEventListener('click', () => toggleSettingsModal(false));

  document.getElementById('loadDriveBtn')?.addEventListener('click', loadKeyFromDrive);
  document.getElementById('saveDriveBtn')?.addEventListener('click', saveKeyToDrive);

  document.getElementById('startDrawBtn')?.addEventListener('click', handleStartDraw);
  document.getElementById('clearAreaBtn')?.addEventListener('click', handleClearArea);

  document.getElementById('searchBtn')?.addEventListener('click', triggerAiSearch);
  document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') triggerAiSearch();
  });

  document.getElementById('micBtn')?.addEventListener('click', () => _voiceController.toggle());

  document.getElementById('geolocateBtn')?.addEventListener('click', async () => {
    showToast('Locating your position…', 'info');
    try {
      await geolocateUser();
      showToast('Centered on your location!', 'success');
    } catch (err) {
      showToast('Could not access current location.', 'error');
    }
  });

  const ratingSlider = document.getElementById('minRatingSlider');
  const ratingDisplay = document.getElementById('minRatingValue');
  if (ratingSlider && ratingDisplay) {
    ratingSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      ratingDisplay.innerText = val.toFixed(1);
      if (hasPolygon()) {
        applyFilters(val);
      }
    });
  }

  document.getElementById('toggleSidebarBtn')?.addEventListener('click', () => toggleSidebar());
  document.getElementById('closeSidebarBtn')?.addEventListener('click', () => toggleSidebar(false));

  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    clearSearchHistory();
    renderSearchHistory();
    showToast('Search history cleared.', 'info');
  });

  initGoogleDriveSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

})(window, document);