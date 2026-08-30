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
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    // Check if script tag already exists
    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      existingScript.onload = () => resolve();
      existingScript.onerror = (e) => reject(e);
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&libraries=geometry,places&loading=async`;
    script.async = true;
    script.defer = true;

    // Use callback or window onload
    window.__gmInitCallback = () => {
      resolve();
      delete window.__gmInitCallback;
    };
    script.src += `&callback=__gmInitCallback`;

    script.onerror = () => {
      reject(new Error('Failed to load Google Maps API. Please check your API key and network connection.'));
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
 * Configures Google Places Autocomplete on a location search input element.
 * Supports dropdown suggestions as well as automatic Geocoding fallback on Enter key.
 * @param {HTMLInputElement} inputElement 
 * @param {Function} onPlaceSelected 
 */
export function setupLocationAutocomplete(inputElement, onPlaceSelected) {
  if (!mapInstance || !inputElement) return;

  autocompleteInstance = new google.maps.places.Autocomplete(inputElement, {
    fields: ['geometry', 'name', 'formatted_address', 'place_id']
  });
  autocompleteInstance.bindTo('bounds', mapInstance);

  const geocoder = new google.maps.Geocoder();

  function handleGeocodeResult(results, status, queryName) {
    if (status === 'OK' && results && results[0]) {
      const placeResult = results[0];
      if (placeResult.geometry.viewport) {
        mapInstance.fitBounds(placeResult.geometry.viewport);
      } else if (placeResult.geometry.location) {
        mapInstance.setCenter(placeResult.geometry.location);
        mapInstance.setZoom(13);
      }
      inputElement.blur();
      if (onPlaceSelected) {
        onPlaceSelected({
          name: queryName || placeResult.formatted_address,
          formatted_address: placeResult.formatted_address,
          geometry: placeResult.geometry
        });
      }
    } else {
      if (onPlaceSelected) onPlaceSelected(null, `Could not find "${queryName}". Please check the spelling.`);
    }
  }

  autocompleteInstance.addListener('place_changed', () => {
    const place = autocompleteInstance.getPlace();
    if (place && place.geometry && place.geometry.location) {
      if (place.geometry.viewport) {
        mapInstance.fitBounds(place.geometry.viewport);
      } else {
        mapInstance.setCenter(place.geometry.location);
        mapInstance.setZoom(13);
      }
      inputElement.blur();
      if (onPlaceSelected) {
        onPlaceSelected(place);
      }
    } else {
      const query = place?.name || inputElement.value.trim();
      if (query) {
        geocoder.geocode({ address: query }, (results, status) => {
          handleGeocodeResult(results, status, query);
        });
      }
    }
  });

  // Handle Enter keypress for directly typed city names
  inputElement.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = inputElement.value.trim();
      if (!val) return;

      setTimeout(() => {
        const place = autocompleteInstance.getPlace();
        if (!place || !place.geometry) {
          geocoder.geocode({ address: val }, (results, status) => {
            handleGeocodeResult(results, status, val);
          });
        }
      }, 150);
    }
  });

  return autocompleteInstance;
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
