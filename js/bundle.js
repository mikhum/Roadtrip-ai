/**
 * AIRoadtrip - Single Bundle
 * All modules in dependency order. No ES module imports.
 * Works reliably on Android Chrome and Brave.
 */
'use strict';

// == VOICE ==
/**
 * AIRoadtrip — Voice Input Module
 * Handles Web Speech API speech recognition for hands-free queries.
 */

class VoiceInputController {
  constructor(options = {}) {
    this.lang = options.lang || 'en-US';
    this.recognition = null;
    this.isListening = false;

    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || (() => {});

    this.init();
  }

  /**
   * Check if speech recognition is supported in this browser
   */
  static isSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  /**
   * Initialize SpeechRecognition instance
   */
  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

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

  /**
   * Start or toggle speech recognition
   */
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
      console.warn('Speech recognition already started or failed:', e);
    }
  }

  stop() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch (e) {
      console.warn('Error stopping speech recognition:', e);
    }
  }

  setLanguage(lang) {
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  getLanguage() {
    return this.lang;
  }
}

VoiceInputController;

// == DRAW ==
/**
 * AIRoadtrip — Freehand Polygon Drawing Module
 * Enables the user to draw freehand search boundaries on the Google Map using mouse or touch gestures.
 */

let mapInstance = null;
let mapContainer = null;
let currentPolygon = null;
let freehandPolyline = null;
let freehandPath = [];
let isDrawingActive = false;
let isModeEnabled = false;
let boundEventListeners = [];

let callbacks = {
  onDrawStart: () => {},
  onDrawComplete: (polygon) => {},
  onDrawCancel: () => {}
};

/**
 * Initialize the drawing module with map and container references.
 * @param {google.maps.Map} map 
 * @param {HTMLElement} container 
 * @param {Object} cbs 
 */
function initDrawing(map, container, cbs = {}) {
  mapInstance = map;
  mapContainer = container;
  callbacks = { ...callbacks, ...cbs };
}

/**
 * Converts screen/client pixel coordinates to Google Maps LatLng.
 * @param {MouseEvent|TouchEvent} e 
 * @returns {google.maps.LatLng}
 */
function getLatLngFromEvent(e) {
  if (!mapInstance || !mapContainer) return null;

  const rect = mapContainer.getBoundingClientRect();
  const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;

  const point = new google.maps.Point(clientX - rect.left, clientY - rect.top);
  const projection = mapInstance.getProjection();
  const bounds = mapInstance.getBounds();

  if (!projection || !bounds) return null;

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const scale = Math.pow(2, mapInstance.getZoom());

  const worldPoint = new google.maps.Point(
    (point.x / scale) + projection.fromLatLngToPoint(new google.maps.LatLng(ne.lat(), sw.lng())).x,
    (point.y / scale) + projection.fromLatLngToPoint(new google.maps.LatLng(ne.lat(), sw.lng())).y
  );

  return projection.fromPointToLatLng(worldPoint);
}

/**
 * Starts freehand path recording.
 */
function handleStart(e) {
  if (!isModeEnabled) return;
  if (e.target.closest('#map') || e.target === mapContainer) {
    e.preventDefault();
  }

  isDrawingActive = true;
  const latLng = getLatLngFromEvent(e);
  if (!latLng) return;

  freehandPath = [latLng];

  // Remove existing polygon if redrawing
  if (currentPolygon) {
    currentPolygon.setMap(null);
    currentPolygon = null;
  }

  if (freehandPolyline) {
    freehandPolyline.setMap(null);
    freehandPolyline = null;
  }

  callbacks.onDrawStart();
}

/**
 * Appends points to freehand path while dragging.
 */
function handleMove(e) {
  if (!isModeEnabled || !isDrawingActive) return;
  if (e.target.closest('#map') || e.target === mapContainer) {
    e.preventDefault();
  }

  const latLng = getLatLngFromEvent(e);
  if (!latLng) return;

  freehandPath.push(latLng);

  if (freehandPolyline) {
    freehandPolyline.setPath(freehandPath);
  } else {
    freehandPolyline = new google.maps.Polyline({
      path: freehandPath,
      strokeColor: '#4f46e5',
      strokeOpacity: 0.85,
      strokeWeight: 3,
      map: mapInstance
    });
  }
}

/**
 * Finalizes freehand drawing and creates a Google Maps Polygon.
 */
function handleEnd() {
  if (!isModeEnabled || !isDrawingActive) return;

  isDrawingActive = false;
  deactivateDrawMode();

  if (freehandPolyline) {
    freehandPolyline.setMap(null);
    freehandPolyline = null;
  }

  // Need at least 3 points to form a valid polygon
  if (freehandPath.length < 3) {
    freehandPath = [];
    callbacks.onDrawCancel();
    return;
  }

  currentPolygon = new google.maps.Polygon({
    paths: freehandPath,
    strokeColor: '#4f46e5',
    strokeOpacity: 0.9,
    strokeWeight: 2.5,
    fillColor: '#4f46e5',
    fillOpacity: 0.15,
    clickable: false,
    map: mapInstance
  });

  callbacks.onDrawComplete(currentPolygon);
}

/**
 * Activates freehand drawing mode on the map.
 */
function activateDrawMode() {
  if (!mapInstance || !mapContainer || isModeEnabled) return;

  isModeEnabled = true;

  // Lock map interaction during draw
  mapInstance.setOptions({
    draggable: false,
    gestureHandling: 'none',
    draggableCursor: 'crosshair'
  });

  const events = [
    { type: 'mousedown', fn: handleStart },
    { type: 'touchstart', fn: handleStart },
    { type: 'mousemove', fn: handleMove },
    { type: 'touchmove', fn: handleMove },
    { type: 'mouseup', fn: handleEnd },
    { type: 'touchend', fn: handleEnd },
    { type: 'mouseleave', fn: handleEnd }
  ];

  events.forEach(({ type, fn }) => {
    mapContainer.addEventListener(type, fn, { passive: false });
    boundEventListeners.push({ type, fn });
  });
}

/**
 * Deactivates freehand drawing mode and restores regular map interaction.
 */
function deactivateDrawMode() {
  isModeEnabled = false;
  isDrawingActive = false;

  if (mapInstance) {
    mapInstance.setOptions({
      draggable: true,
      gestureHandling: 'greedy',
      draggableCursor: ''
    });
  }

  boundEventListeners.forEach(({ type, fn }) => {
    if (mapContainer) {
      mapContainer.removeEventListener(type, fn);
    }
  });
  boundEventListeners = [];
}

/**
 * Clears the currently drawn polygon from the map.
 */
function clearCurrentPolygon() {
  if (currentPolygon) {
    currentPolygon.setMap(null);
    currentPolygon = null;
  }
  if (freehandPolyline) {
    freehandPolyline.setMap(null);
    freehandPolyline = null;
  }
  freehandPath = [];
}

/**
 * Returns the currently active polygon instance.
 * @returns {google.maps.Polygon|null}
 */
function getCurrentPolygon() {
  return currentPolygon;
}

/**
 * Returns whether a polygon currently exists on the map.
 * @returns {boolean}
 */
function hasPolygon() {
  return currentPolygon !== null;
}

/**
 * Returns whether draw mode is currently enabled.
 * @returns {boolean}
 */
function isDrawing() {
  return isModeEnabled;
}

// == MARKERS ==
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
function initMarkers(map, infoWindow, listEl, countEl) {
  mapInstance = map;
  infoWindowInstance = infoWindow;
  sidebarListElement = listEl;
  sidebarCountElement = countEl;
}

/**
 * Sets the active Google API Key for photo loading.
 * @param {string} apiKey 
 */
function setApiKey(apiKey) {
  currentApiKey = apiKey;
}

/**
 * Sets the active places dataset and polygon, then applies rating filter.
 * @param {Array<Object>} places 
 * @param {google.maps.Polygon} polygon 
 * @param {number} minRating 
 */
function setPlaces(places, polygon, minRating = 1.0) {
  currentPlacesData = places || [];
  activePolygon = polygon;
  currentMinRating = minRating;
  applyFilters();
}

/**
 * Clears all markers from the map and resets sidebar.
 */
function clearMarkers() {
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
function applyFilters(newMinRating = null) {
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
function getPhotoUrl(place) {
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
function openPlaceInfoWindow(place, marker) {
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
function focusPlace(placeId) {
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

// == SEARCH ==
/**
 * AIRoadtrip — Search & AI Translation Module
 * Translates natural language queries using Gemini AI and queries Google Places API (New).
 * Manages search history in localStorage.
 */

const HISTORY_STORAGE_KEY = 'ai_roadtrip_search_history';
const MAX_HISTORY_ITEMS = 5;

/**
 * Calculates bounding rectangle (north, south, east, west) from a Google Maps Polygon.
 * @param {google.maps.Polygon} polygon 
 * @returns {{north: number, south: number, east: number, west: number}}
 */
function getPolygonBounds(polygon) {
  const polygonPath = polygon.getPath();
  let north = -90, south = 90, east = -180, west = 180;

  for (let i = 0; i < polygonPath.getLength(); i++) {
    const pt = polygonPath.getAt(i);
    const lat = pt.lat();
    const lng = pt.lng();

    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }

  return { north, south, east, west };
}

/**
 * Uses Google Gemini AI to translate a natural language prompt into an optimized Google Places Text Search query.
 * @param {string} userPrompt 
 * @param {string} apiKey 
 * @returns {Promise<string>}
 */
async function optimizeQueryWithGemini(userPrompt, apiKey) {
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('Please enter a search prompt.');
  }

  if (!apiKey) {
    throw new Error('Google API key is required.');
  }

  const promptText = userPrompt.trim();

  // Primary model: gemini-2.5-flash for fast and accurate responses
  const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash'];
  let lastError = null;

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
Respond ONLY with a valid JSON object in this format: {"searchQuery": "optimized search phrase"}. Do not include markdown code block backticks if possible, just the raw JSON.`
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `Gemini API returned status ${response.status}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error('Empty response received from Gemini.');
      }

      // Clean markdown if present
      const cleanJson = content.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed && parsed.searchQuery) {
        return parsed.searchQuery;
      }
    } catch (err) {
      console.warn(`Gemini translation with model ${model} failed:`, err);
      lastError = err;
    }
  }

  // Fallback to original prompt if Gemini encounters issues
  console.info('Falling back to raw user prompt:', promptText);
  return promptText;
}

/**
 * Searches for places within a polygon bounding box using Google Places API (New).
 * @param {string} queryStr 
 * @param {google.maps.Polygon} polygon 
 * @param {string} apiKey 
 * @returns {Promise<Array<Object>>}
 */
async function searchPlacesInPolygon(queryStr, polygon, apiKey) {
  if (!polygon) {
    throw new Error('Please draw a search area on the map first.');
  }

  if (!queryStr || !queryStr.trim()) {
    throw new Error('Search query cannot be empty.');
  }

  if (!apiKey) {
    throw new Error('API key is missing.');
  }

  const bounds = getPolygonBounds(polygon);

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

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Places API request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.places || [];
}

/**
 * Retrieves search history from localStorage.
 * @returns {Array<{query: string, translatedQuery: string, timestamp: number}>}
 */
function getSearchHistory() {
  try {
    const history = localStorage.getItem(HISTORY_STORAGE_KEY);
    return history ? JSON.parse(history) : [];
  } catch (e) {
    console.error('Error reading search history:', e);
    return [];
  }
}

/**
 * Saves a new query to search history in localStorage.
 * @param {string} query 
 * @param {string} translatedQuery 
 */
function saveSearchToHistory(query, translatedQuery = '') {
  if (!query || !query.trim()) return;

  try {
    let history = getSearchHistory();
    // Remove duplicates
    history = history.filter(item => item.query.toLowerCase() !== query.toLowerCase());

    history.unshift({
      query: query.trim(),
      translatedQuery: translatedQuery.trim(),
      timestamp: Date.now()
    });

    if (history.length > MAX_HISTORY_ITEMS) {
      history = history.slice(0, MAX_HISTORY_ITEMS);
    }

    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('Error saving search history:', e);
  }
}

/**
 * Clears search history from localStorage.
 */
function clearSearchHistory() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
}

// == MAP ==
/**
 * AIRoadtrip — Google Maps & Geolocation Module
 * Handles dynamic API loading, map initialization, custom styling,
 * destination autocomplete, and user geolocation.
 */

// Modern Clean Map Style (reduces POI clutter for highlighted search results)
const MODERN_MAP_STYLE = [
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }]
  },
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }]
  },
  {
    featureType: "transit",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }]
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#dbeafe" }]
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#f8fafc" }]
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }]
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#e2e8f0" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#fed7aa" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#fdba74" }]
  }
];

let mapInstance = null;
let infoWindowInstance = null;
let userLocationMarker = null;
let autocompleteInstance = null;

/**
 * Dynamically loads the Google Maps JavaScript API script if not already loaded.
 * @param {string} apiKey 
 * @returns {Promise<void>}
 */
function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps && window.google.maps.Map) {
      resolve();
      return;
    }

    // Check if script tag already exists
    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      if (window.google && window.google.maps && window.google.maps.Map) {
        resolve();
      } else {
        existingScript.addEventListener('load', () => {
          if (window.google && window.google.maps) resolve();
        });
        existingScript.addEventListener('error', (e) => reject(e));
      }
      return;
    }

    let isResolved = false;
    function finish() {
      if (!isResolved) {
        isResolved = true;
        resolve();
      }
    }

    window.__gmInitCallback = () => {
      finish();
    };

    const cleanKey = apiKey ? apiKey.trim() : '';
    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cleanKey)}&libraries=geometry,places&callback=__gmInitCallback`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      setTimeout(() => {
        if (window.google && window.google.maps) {
          finish();
        }
      }, 100);
    };

    script.onerror = (e) => {
      reject(new Error('Failed to load Google Maps API. Please verify your API key and internet connection.'));
    };

    document.head.appendChild(script);
  });
}

/**
 * Initializes the Google Map on the specified container element.
 * @param {string|HTMLElement} container
 * @param {google.maps.MapOptions} options
 * @returns {google.maps.Map}
 */
function initMap(container, options = {}) {
  const element = typeof container === 'string' ? document.getElementById(container) : container;
  if (!element) {
    throw new Error('Map container element not found.');
  }

  const defaultOptions = {
    center: { lat: 59.3293, lng: 18.0686 }, // Default center (Stockholm)
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_BOTTOM
    },
    gestureHandling: 'greedy',
    styles: MODERN_MAP_STYLE
  };

  mapInstance = new google.maps.Map(element, { ...defaultOptions, ...options });
  infoWindowInstance = new google.maps.InfoWindow();

  return mapInstance;
}

/**
 * Returns the current Google Map instance.
 * @returns {google.maps.Map|null}
 */
function getMap() {
  return mapInstance;
}

/**
 * Returns the shared InfoWindow instance.
 * @returns {google.maps.InfoWindow|null}
 */
function getInfoWindow() {
  return infoWindowInstance;
}

/**
 * Navigates the map to a city, region, or address using Places API (New) searchText with Geocoder fallback.
 * @param {string} queryStr 
 * @param {string} apiKey 
 * @param {Function} onPlaceSelected 
 */
async function jumpToLocation(queryStr, apiKey, onPlaceSelected) {
  if (!mapInstance || !queryStr || !queryStr.trim()) return;
  const trimmed = queryStr.trim();

  // 1. Try Google Places API (New) text search (guaranteed compatible with app API key)
  if (apiKey) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.viewport,places.formattedAddress'
        },
        body: JSON.stringify({
          textQuery: trimmed
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.places && data.places.length > 0) {
          const place = data.places[0];
          if (place.viewport) {
            const bounds = new google.maps.LatLngBounds(
              new google.maps.LatLng(place.viewport.low.latitude, place.viewport.low.longitude),
              new google.maps.LatLng(place.viewport.high.latitude, place.viewport.high.longitude)
            );
            mapInstance.fitBounds(bounds);
          } else if (place.location) {
            mapInstance.setCenter({ lat: place.location.latitude, lng: place.location.longitude });
            mapInstance.setZoom(13);
          }

          if (onPlaceSelected) {
            onPlaceSelected({
              name: place.displayName?.text || place.formattedAddress,
              formatted_address: place.formattedAddress,
              location: place.location
            });
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Places API (New) search failed for location jump:', e);
    }
  }

  // 2. Fallback to google.maps.Geocoder
  try {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: trimmed }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const placeResult = results[0];
        if (placeResult.geometry.viewport) {
          mapInstance.fitBounds(placeResult.geometry.viewport);
        } else if (placeResult.geometry.location) {
          mapInstance.setCenter(placeResult.geometry.location);
          mapInstance.setZoom(13);
        }
        if (onPlaceSelected) {
          onPlaceSelected({
            name: trimmed || placeResult.formatted_address,
            formatted_address: placeResult.formatted_address,
            geometry: placeResult.geometry
          });
        }
      } else {
        if (onPlaceSelected) onPlaceSelected(null, `Could not find "${trimmed}". Please check the spelling.`);
      }
    });
  } catch (err) {
    if (onPlaceSelected) onPlaceSelected(null, `Could not find "${trimmed}".`);
  }
}

/**
 * Configures modern city/region search and custom suggestions dropdown.
 * Powered 100% by Google Places API (New) with zero legacy errors.
 * @param {HTMLInputElement} inputElement 
 * @param {string} apiKey 
 * @param {Function} onPlaceSelected 
 */
function setupLocationAutocomplete(inputElement, apiKey, onPlaceSelected) {
  if (!mapInstance || !inputElement) return;

  const dropdown = document.getElementById('locationDropdown');
  let debounceTimeout = null;
  let currentResults = [];

  function closeDropdown() {
    if (dropdown) dropdown.classList.add('hidden');
  }

  function renderSuggestions(places) {
    if (!dropdown) return;
    if (!places || places.length === 0) {
      closeDropdown();
      return;
    }

    currentResults = places;
    dropdown.innerHTML = places.slice(0, 5).map((place, idx) => `
      <div class="location-item px-3 py-2 text-xs hover:bg-indigo-50 cursor-pointer flex items-center gap-2 border-b border-slate-50 last:border-none transition-colors" data-index="${idx}">
        <svg class="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
        <div class="min-w-0 flex-1 text-left">
          <p class="font-semibold text-slate-800 truncate">${place.displayName?.text || place.formattedAddress}</p>
          <p class="text-[10px] text-slate-400 truncate">${place.formattedAddress || ''}</p>
        </div>
      </div>
    `).join('');

    dropdown.querySelectorAll('.location-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        const place = currentResults[index];
        if (place) {
          inputElement.value = place.displayName?.text || place.formattedAddress;
          closeDropdown();

          if (place.viewport) {
            const bounds = new google.maps.LatLngBounds(
              new google.maps.LatLng(place.viewport.low.latitude, place.viewport.low.longitude),
              new google.maps.LatLng(place.viewport.high.latitude, place.viewport.high.longitude)
            );
            mapInstance.fitBounds(bounds);
          } else if (place.location) {
            mapInstance.setCenter({ lat: place.location.latitude, lng: place.location.longitude });
            mapInstance.setZoom(13);
          }

          if (onPlaceSelected) {
            onPlaceSelected({
              name: place.displayName?.text || place.formattedAddress,
              formatted_address: place.formattedAddress,
              location: place.location
            });
          }
        }
      });
    });

    dropdown.classList.remove('hidden');
  }

  async function fetchCitySuggestions(query) {
    if (!apiKey || !query || query.length < 2) {
      closeDropdown();
      return;
    }

    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.viewport,places.formattedAddress'
        },
        body: JSON.stringify({
          textQuery: query
        })
      });

      if (res.ok) {
        const data = await res.json();
        renderSuggestions(data.places || []);
      }
    } catch (e) {
      console.warn('Autocomplete fetch error:', e);
    }
  }

  // Real-time debounced typing listener
  inputElement.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(debounceTimeout);
    if (val.length < 2) {
      closeDropdown();
      return;
    }
    debounceTimeout = setTimeout(() => {
      fetchCitySuggestions(val);
    }, 280);
  });

  // Handle Enter keypress for directly typed city names
  inputElement.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      closeDropdown();
      const val = inputElement.value.trim();
      if (!val) return;

      inputElement.blur();
      jumpToLocation(val, apiKey, onPlaceSelected);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!inputElement.contains(e.target) && (!dropdown || !dropdown.contains(e.target))) {
      closeDropdown();
    }
  });
}

/**
 * Request user's current GPS position and center map.
 * @returns {Promise<google.maps.LatLngLiteral>}
 */
function geolocateUser() {
  return new Promise((resolve, reject) => {
    if (!mapInstance) {
      reject(new Error('Map is not initialized.'));
      return;
    }

    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const pos = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        mapInstance.panTo(pos);
        mapInstance.setZoom(14);

        // Update or create user location marker
        if (userLocationMarker) {
          userLocationMarker.setPosition(pos);
          userLocationMarker.setMap(mapInstance);
        } else {
          userLocationMarker = new google.maps.Marker({
            position: pos,
            map: mapInstance,
            title: 'Your Location',
            zIndex: 9999,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#4f46e5',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2.5
            }
          });
        }

        resolve(pos);
      },
      (error) => {
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// == APP ==
/**
 * AIRoadtrip — Main Application Coordinator
 * Bootstraps the application, coordinates Google Maps, Gemini AI,
 * Google Drive OAuth sync, search history, toasts, and UI interactions.
 */


// Configuration & Constants
const CLIENT_ID = '940508107225-2h91m1o4he6r27g1q7hgtaq0f6127dd8.apps.googleusercontent.com';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'roadtrip_config.json';
const API_KEY_STORAGE_KEY = 'googleMapsApiKey';

// App State
let apiKey = '';
let voiceController = null;
let gapiInited = false;
let gisInited = false;
let tokenClient = null;

// ==========================================================================
// Toast Notification System
// ==========================================================================

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

// ==========================================================================
// Google Drive Sync Integration
// ==========================================================================

function initGoogleDriveSync() {
  window.gapiLoaded = function () {
    if (!window.gapi) return;
    gapi.load('client', async () => {
      try {
        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        gapiInited = true;
        enableDriveButtons();
      } catch (e) {
        console.error('GAPI init error:', e);
      }
    });
  };

  window.gisLoaded = function () {
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: ''
      });
      gisInited = true;
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
  if (gapiInited && gisInited && loadBtn && saveBtn) {
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
      tokenClient.callback = (resp) => {
        if (resp.error !== undefined) reject(resp);
        else resolve();
      };
      tokenClient.requestAccessToken({ prompt: 'consent' });
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
    const fileMetadata = { name: FILE_NAME, parents: ['appDataFolder'] };
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelim = "\r\n--" + boundary + "--";

    const multipartRequestBody = delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(fileMetadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelim;

    const request = gapi.client.request({
      path: files && files.length > 0 ? '/upload/drive/v3/files/' + files[0].id : '/upload/drive/v3/files',
      method: files && files.length > 0 ? 'PATCH' : 'POST',
      params: { uploadType: 'multipart' },
      headers: { 'Content-Type': 'multipart/related; boundary="' + boundary + '"' },
      body: multipartRequestBody
    });

    request.execute((file) => {
      if (file.error) {
        setDriveStatus('Could not save to Drive.', 'error');
      } else {
        setDriveStatus('API key saved securely to Google Drive!', 'success');
        showToast('Saved to Google Drive', 'success');
      }
    });
  } catch (err) {
    console.error('Error saving key to Drive:', err);
    setDriveStatus('An error occurred during save.', 'error');
  }
}

// ==========================================================================
// App Initialization & Settings Management
// ==========================================================================

function toggleSettingsModal(force = null) {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  if (force === true) modal.classList.remove('hidden');
  else if (force === false) modal.classList.add('hidden');
  else modal.classList.toggle('hidden');
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
  if (!inputVal) {
    showToast('Please enter a valid Google API key.', 'warning');
    return;
  }

  apiKey = inputVal;
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  setApiKey(apiKey);
  toggleSettingsModal(false);
  showToast('API key saved. Starting map…', 'success');

  bootstrapMap();
}

/**
 * Loads Maps script and sets up all submodules.
 */
async function bootstrapMap() {
  const overlay = document.getElementById('mapOverlay');
  const overlayText = document.getElementById('overlayText');
  const overlaySpinner = document.getElementById('overlaySpinner');
  const overlayOpenSettingsBtn = document.getElementById('overlayOpenSettingsBtn');

  if (!apiKey) {
    if (overlay) overlay.classList.remove('hidden');
    if (overlaySpinner) overlaySpinner.classList.add('hidden');
    if (overlayText) {
      overlayText.className = 'text-slate-600 font-semibold text-sm';
      overlayText.innerText = 'Please enter your Google Cloud API key to start the map.';
    }
    if (overlayOpenSettingsBtn) overlayOpenSettingsBtn.classList.remove('hidden');
    toggleSettingsModal(true);
    return;
  }

  try {
    if (overlay) overlay.classList.remove('hidden');
    if (overlaySpinner) overlaySpinner.classList.remove('hidden');
    if (overlayOpenSettingsBtn) overlayOpenSettingsBtn.classList.add('hidden');
    if (overlayText) {
      overlayText.className = 'text-indigo-600 font-bold text-sm tracking-wide';
      overlayText.innerText = 'Loading modern map…';
    }

    await loadGoogleMapsScript(apiKey);

    const map = initMap('map');
    const infoWindow = getInfoWindow();

    // Trigger map resize for mobile Android browsers to ensure tile rendering
    setTimeout(() => {
      if (window.google && window.google.maps && map) {
        google.maps.event.trigger(map, 'resize');
      }
    }, 150);
    setTimeout(() => {
      if (window.google && window.google.maps && map) {
        google.maps.event.trigger(map, 'resize');
      }
    }, 450);

    // Init Markers & Sidebar
    const sidebarList = document.getElementById('sidebarList');
    const sidebarCount = document.getElementById('sidebarCount');
    initMarkers(map, infoWindow, sidebarList, sidebarCount);
    setApiKey(apiKey);

    // Init Drawing
    const mapDiv = document.getElementById('map');
    initDrawing(map, mapDiv, {
      onDrawStart: () => {
        document.getElementById('drawModeNotice')?.classList.remove('hidden');
        document.getElementById('floatingMapControls')?.classList.add('hidden');
      },
      onDrawComplete: (polygon) => {
        document.getElementById('drawModeNotice')?.classList.add('hidden');
        document.getElementById('floatingMapControls')?.classList.remove('hidden');
        
        // Show clear button and update draw button text
        document.getElementById('clearAreaBtn')?.classList.remove('hidden');
        
        const startText = document.getElementById('startDrawBtnText');
        if (startText) startText.innerText = 'Redraw Area';

        showToast('Area defined! Enter your query or click Search.', 'info');
        
        // Auto trigger search if query is already present
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

    // Init Autocomplete & Location Jump (in Drawer)
    const locationInput = document.getElementById('locationSearch');
    setupLocationAutocomplete(locationInput, apiKey, (place, err) => {
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
        jumpToLocation(val, apiKey, (place, err) => {
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

    if (overlay) overlay.classList.add('hidden');
    document.getElementById('floatingMapControls')?.classList.remove('hidden');

  } catch (err) {
    console.error('Error bootstrapping map:', err);
    if (overlay) overlay.classList.add('hidden');
    showToast(`Failed to load Google Maps: ${err.message || err}`, 'error', 8000);
    toggleSettingsModal(true);
  }
}

// Google Maps global authentication failure handler
window.gm_authFailure = () => {
  console.error('Google Maps API Authentication Failed (gm_authFailure)');
  const overlay = document.getElementById('mapOverlay');
  if (overlay) overlay.classList.add('hidden');
  showToast('Google Maps API Key Error: Please check your API key restrictions and billing in Google Cloud Console.', 'error', 9000);
  toggleSettingsModal(true);
};

// ==========================================================================
// Search Operations
// ==========================================================================

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
  const originalBtnContent = searchBtn ? searchBtn.innerHTML : '';
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = `<span class="spinner"></span><span>Searching…</span>`;
  }

  clearMarkers();
  showToast('AI is optimizing your search query…', 'info', 2000);

  try {
    // 1. Gemini query optimization
    const optimizedQuery = await optimizeQueryWithGemini(queryText, apiKey);
    
    // Save to history
    saveSearchToHistory(queryText, optimizedQuery);
    renderSearchHistory();

    showToast(`Searching places for: "${optimizedQuery}"…`, 'info', 2000);

    // 2. Google Places API (New) spatial text search
    const places = await searchPlacesInPolygon(optimizedQuery, polygon, apiKey);

    // 3. Render markers & sidebar
    const minRating = parseFloat(document.getElementById('minRatingSlider').value);
    setPlaces(places, polygon, minRating);

    const filtered = applyFilters();
    if (filtered.length > 0) {
      showToast(`Found ${filtered.length} matching places!`, 'success');
      // Ensure sidebar is visible on desktop / toggle open
      toggleSidebar(true);
    } else {
      showToast('No places matched your search and rating criteria.', 'warning');
    }

  } catch (err) {
    console.error('Search error:', err);
    showToast(`Search failed: ${err.message}`, 'error', 5000);
  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.innerHTML = originalBtnContent;
    }
  }
}

function handleStartDraw() {
  if (!getMap() || !apiKey) {
    showToast('Please enter your Google API key in Settings first.', 'warning');
    toggleSettingsModal(true);
    return;
  }
  activateDrawMode();
  showToast('Click and drag across the map to outline your search area.', 'info');
}

function handleClearArea() {
  clearCurrentPolygon();
  clearMarkers();
  
  // Hide clear buttons and reset button text
  document.getElementById('clearAreaBtn')?.classList.add('hidden');
  document.getElementById('headerClearBtn')?.classList.add('hidden');
  
  const startText = document.getElementById('startDrawBtnText');
  if (startText) startText.innerText = 'Draw Search Area';
  const headerText = document.getElementById('headerDrawBtnText');
  if (headerText) headerText.innerText = 'Draw Area';

  document.getElementById('searchInput').value = '';
  showToast('Area and results cleared.', 'info');
}

// ==========================================================================
// Hamburger Drawer & Navigation Coordinator
// ==========================================================================

function toggleDrawer(open) {
  const drawer = document.getElementById('navDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (!drawer || !backdrop) return;

  const shouldOpen = open !== undefined ? open : drawer.classList.contains('translate-x-full');
  if (shouldOpen) {
    backdrop.classList.remove('hidden');
    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.remove('opacity-0');
      drawer.classList.remove('translate-x-full');
    });
    renderSearchHistory();
  } else {
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('opacity-0');
    setTimeout(() => {
      backdrop.classList.add('hidden');
    }, 300);
  }
}

// ==========================================================================
// Search History Rendering
// ==========================================================================

function renderSearchHistory() {
  const drawerContainer = document.getElementById('drawerSearchHistoryList');
  const history = getSearchHistory();

  if (drawerContainer) {
    if (history.length === 0) {
      drawerContainer.innerHTML = `<p class="text-xs text-slate-400 p-2 text-center">No recent searches</p>`;
    } else {
      drawerContainer.innerHTML = history.map(item => `
        <button class="history-item w-full text-left px-2.5 py-1.5 text-xs hover:bg-indigo-50 hover:text-indigo-700 rounded-lg transition-colors flex items-center justify-between group" data-query="${encodeURIComponent(item.query)}">
          <span class="font-medium text-slate-700 group-hover:text-indigo-700 truncate">${item.query}</span>
          <svg class="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
        </button>
      `).join('');

      drawerContainer.querySelectorAll('.history-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const q = decodeURIComponent(btn.dataset.query);
          document.getElementById('searchInput').value = q;
          toggleDrawer(false);
          triggerAiSearch();
        });
      });
    }
  }
}

// Voice Language Configuration
const VOICE_LANG_STORAGE_KEY = 'ai_roadtrip_voice_lang';
let currentVoiceLang = localStorage.getItem(VOICE_LANG_STORAGE_KEY) || 'sv-SE';

function setVoiceLanguage(lang, notify = true) {
  currentVoiceLang = lang;
  localStorage.setItem(VOICE_LANG_STORAGE_KEY, lang);

  if (voiceController) {
    voiceController.setLanguage(lang);
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

// ==========================================================================
// Setup Event Listeners & Boot
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Check stored API key
  const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (savedKey) {
    apiKey = savedKey;
    document.getElementById('apiKeyInput').value = savedKey;
    bootstrapMap();
  } else {
    toggleSettingsModal(true);
  }

  // Voice Recognition Setup
  const micBtn = document.getElementById('micBtn');
  voiceController = new VoiceInputController({
    lang: currentVoiceLang,
    onStart: () => {
      if (micBtn) micBtn.classList.add('mic-active');
      const langLabel = currentVoiceLang === 'sv-SE' ? 'Svenska 🇸🇪' : 'English 🇬🇧';
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

  // Attach Drawer Language Buttons
  document.getElementById('langOptionSv')?.addEventListener('click', () => setVoiceLanguage('sv-SE', true));
  document.getElementById('langOptionEn')?.addEventListener('click', () => setVoiceLanguage('en-US', true));
  document.getElementById('voiceLangSelect')?.addEventListener('change', (e) => setVoiceLanguage(e.target.value, true));

  // Initialize Voice Language UI
  setVoiceLanguage(currentVoiceLang, false);

  // Hamburger Drawer Toggles
  document.getElementById('hamburgerBtn')?.addEventListener('click', () => toggleDrawer(true));
  document.getElementById('closeDrawerBtn')?.addEventListener('click', () => toggleDrawer(false));
  document.getElementById('drawerBackdrop')?.addEventListener('click', () => toggleDrawer(false));

  // Drawer Clear Button
  document.getElementById('drawerClearBtn')?.addEventListener('click', () => {
    handleClearArea();
    toggleDrawer(false);
  });

  // Drawer Settings Button
  document.getElementById('drawerOpenSettingsBtn')?.addEventListener('click', () => {
    toggleDrawer(false);
    toggleSettingsModal(true);
  });

  // Attach Modal Settings Listeners
  document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettingsAndStart);
  document.getElementById('openSettingsBtn')?.addEventListener('click', () => toggleSettingsModal(true));
  document.getElementById('closeSettingsBtn')?.addEventListener('click', () => toggleSettingsModal(false));

  document.getElementById('loadDriveBtn')?.addEventListener('click', loadKeyFromDrive);
  document.getElementById('saveDriveBtn')?.addEventListener('click', saveKeyToDrive);

  // Map Floating Draw & Clear Buttons
  document.getElementById('startDrawBtn')?.addEventListener('click', handleStartDraw);
  document.getElementById('clearAreaBtn')?.addEventListener('click', handleClearArea);

  // Search Submit (Icon in input bar + Enter key)
  document.getElementById('searchBtn')?.addEventListener('click', triggerAiSearch);
  document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') triggerAiSearch();
  });

  document.getElementById('micBtn')?.addEventListener('click', () => voiceController.toggle());

  document.getElementById('geolocateBtn')?.addEventListener('click', async () => {
    showToast('Locating your position…', 'info');
    try {
      await geolocateUser();
      showToast('Centered on your location!', 'success');
    } catch (err) {
      showToast('Could not access current location.', 'error');
    }
  });

  // Rating Slider
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

  // Sidebar Toggles
  document.getElementById('toggleSidebarBtn')?.addEventListener('click', () => toggleSidebar());
  document.getElementById('closeSidebarBtn')?.addEventListener('click', () => toggleSidebar(false));

  // Drawer History Clear
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    clearSearchHistory();
    renderSearchHistory();
    showToast('Search history cleared.', 'info');
  });

  // Initialize Drive Sync
  initGoogleDriveSync();
});