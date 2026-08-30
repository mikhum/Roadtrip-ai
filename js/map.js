/**
 * AIRoadtrip — Google Maps & Geolocation Module
 * Handles dynamic API loading, map initialization, custom styling,
 * destination autocomplete, and user geolocation.
 */

// Modern Clean Map Style (reduces POI clutter for highlighted search results)
export const MODERN_MAP_STYLE = [
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
export function loadGoogleMapsScript(apiKey) {
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
export function initMap(container, options = {}) {
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
export function getMap() {
  return mapInstance;
}

/**
 * Returns the shared InfoWindow instance.
 * @returns {google.maps.InfoWindow|null}
 */
export function getInfoWindow() {
  return infoWindowInstance;
}

/**
 * Navigates the map to a city, region, or address using Places API (New) searchText with Geocoder fallback.
 * @param {string} queryStr 
 * @param {string} apiKey 
 * @param {Function} onPlaceSelected 
 */
export async function jumpToLocation(queryStr, apiKey, onPlaceSelected) {
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
export function setupLocationAutocomplete(inputElement, apiKey, onPlaceSelected) {
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
