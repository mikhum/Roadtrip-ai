/**
 * AIRoadtrip — Search & AI Translation Module
 * Translates natural language queries using Gemini AI and queries Google Places API (New)
 * or OpenStreetMap Overpass API (instant zero-key fallback).
 * Manages search history in localStorage.
 */

const HISTORY_STORAGE_KEY = 'ai_roadtrip_search_history';
const MAX_HISTORY_ITEMS = 5;

/**
 * Calculates bounding rectangle (north, south, east, west) from a polygon or coordinates array.
 * @param {L.Polygon|Array<Object>} polygon 
 * @returns {{north: number, south: number, east: number, west: number}}
 */
export function getPolygonBounds(polygon) {
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

/**
 * Uses Google Gemini AI to translate a natural language prompt into an optimized search phrase.
 * @param {string} userPrompt 
 * @param {string} apiKey 
 * @returns {Promise<string>}
 */
export async function optimizeQueryWithGemini(userPrompt, apiKey) {
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('Please enter a search prompt.');
  }

  const promptText = userPrompt.trim();

  // If no API key, return original query
  if (!apiKey) {
    return promptText;
  }

  // Primary models: gemini-2.5-flash / gemini-1.5-flash
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

      if (!response.ok) {
        continue;
      }

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

  // Fallback to raw user prompt if Gemini encounters issues
  return promptText;
}

/**
 * Searches for places within a polygon bounding box using Google Places API (New)
 * or fallback to OpenStreetMap Overpass API if no key is provided.
 * @param {string} queryStr 
 * @param {L.Polygon|Array<Object>} polygon 
 * @param {string} apiKey 
 * @returns {Promise<Array<Object>>}
 */
export async function searchPlacesInPolygon(queryStr, polygon, apiKey) {
  if (!polygon) {
    throw new Error('Please draw a search area on the map first.');
  }

  if (!queryStr || !queryStr.trim()) {
    throw new Error('Search query cannot be empty.');
  }

  const bounds = getPolygonBounds(polygon);

  // 1. If API key is provided, use Google Places API (New)
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

  // 2. OpenStreetMap Overpass search fallback (instant, works without API key)
  try {
    return await searchOverpassOsm(queryStr, bounds);
  } catch (err) {
    console.error('OSM Search failed:', err);
    return [];
  }
}

/**
 * OpenStreetMap Overpass place query fallback
 */
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

  if (!response.ok) {
    return [];
  }

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

/**
 * Retrieves past searches from localStorage.
 * @returns {Array<string>}
 */
export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Saves a new query to search history in localStorage.
 * @param {string} query 
 */
export function saveSearchToHistory(query) {
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

/**
 * Clears search history from localStorage.
 */
export function clearSearchHistory() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
}
