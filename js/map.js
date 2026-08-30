/**
 * AIRoadtrip — Interactive Map & Geolocation Module (Leaflet Engine)
 * High-performance, zero-API-key instant map rendering on all desktop and mobile browsers.
 */

let mapInstance = null;
let userLocationMarker = null;

// Modern crisp map tile provider (CARTO Voyager with high-DPI retina support)
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Initializes the Leaflet map on the specified container element.
 * @param {string|HTMLElement} container
 * @param {Object} options
 * @returns {L.Map}
 */
export function initMap(container, options = {}) {
  const containerId = typeof container === 'string' ? container : container.id;
  const element = typeof container === 'string' ? document.getElementById(container) : container;
  if (!element) {
    throw new Error('Map container element not found.');
  }

  // If already initialized, remove old instance
  if (mapInstance) {
    try {
      mapInstance.remove();
    } catch (e) {
      console.warn('Map cleanup error:', e);
    }
    mapInstance = null;
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

  mapInstance = L.map(containerId, { ...defaultOptions, ...options });

  // Add CARTO Voyager tile layer
  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 19,
    detectRetina: true
  }).addTo(mapInstance);

  // Position zoom control at bottom-right
  if (mapInstance.zoomControl) {
    mapInstance.zoomControl.setPosition('bottomright');
  }

  // Force recalculation of container dimensions
  setTimeout(() => {
    mapInstance?.invalidateSize();
  }, 100);
  setTimeout(() => {
    mapInstance?.invalidateSize();
  }, 400);

  return mapInstance;
}

/**
 * Returns the current Leaflet Map instance.
 * @returns {L.Map|null}
 */
export function getMap() {
  return mapInstance;
}

/**
 * Jump and fly map to a queried location name.
 * @param {string} queryStr 
 * @param {string} apiKey 
 * @param {Function} onPlaceSelected 
 */
export async function jumpToLocation(queryStr, apiKey, onPlaceSelected) {
  if (!mapInstance || !queryStr || !queryStr.trim()) return;
  const trimmed = queryStr.trim();

  // 1. Try Google Places API (New) text search if key is provided
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
            mapInstance.fitBounds(bounds, { maxZoom: 14, animate: true, duration: 1.2 });
          } else if (place.location) {
            mapInstance.flyTo([place.location.latitude, place.location.longitude], 13, { duration: 1.2 });
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
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en,sv' }
    });
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
          mapInstance.fitBounds([[south, west], [north, east]], { maxZoom: 14, animate: true, duration: 1.2 });
        } else {
          mapInstance.flyTo([lat, lon], 13, { duration: 1.2 });
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

/**
 * Sets up custom suggestions autocomplete on the search input.
 * @param {HTMLInputElement} inputElement 
 * @param {string} apiKey 
 * @param {Function} onPlaceSelected 
 */
export function setupLocationAutocomplete(inputElement, apiKey, onPlaceSelected) {
  if (!mapInstance || !inputElement) return;

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
        // Use Nominatim for instant autocomplete
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

              mapInstance.flyTo([lat, lon], 13, { duration: 1.2 });
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

/**
 * Center map on user's current GPS location.
 * @returns {Promise<Object>}
 */
export function geolocateUser() {
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
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        mapInstance.flyTo([lat, lng], 14, { duration: 1.2 });

        // Update or create user location pulse marker
        const pulseIcon = L.divIcon({
          className: 'user-location-pulse-container',
          html: '<div class="user-location-pulse"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });

        if (userLocationMarker) {
          userLocationMarker.setLatLng([lat, lng]);
          userLocationMarker.addTo(mapInstance);
        } else {
          userLocationMarker = L.marker([lat, lng], {
            icon: pulseIcon,
            zIndexOffset: 9999,
            title: 'Your Location'
          }).addTo(mapInstance);
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
