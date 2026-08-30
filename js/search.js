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
export function getPolygonBounds(polygon) {
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
export async function optimizeQueryWithGemini(userPrompt, apiKey) {
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
export async function searchPlacesInPolygon(queryStr, polygon, apiKey) {
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
 * Retrieves search history from localStorage with format normalization.
 * @returns {Array<{query: string, translatedQuery: string, timestamp: number}>}
 */
export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(item => {
        if (typeof item === 'string') {
          return { query: item.trim(), translatedQuery: '', timestamp: Date.now() };
        }
        if (item && typeof item === 'object') {
          const q = (item.query || item.userQuery || item.text || item.searchQuery || '').toString().trim();
          const tq = (item.translatedQuery || '').toString().trim();
          return { query: q, translatedQuery: tq, timestamp: item.timestamp || Date.now() };
        }
        return null;
      })
      .filter(item => item && item.query.length > 0);
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
export function saveSearchToHistory(query, translatedQuery = '') {
  if (!query || typeof query !== 'string' || !query.trim()) return;

  try {
    let history = getSearchHistory();
    const qLower = query.trim().toLowerCase();
    history = history.filter(item => item && item.query && item.query.toLowerCase() !== qLower);

    history.unshift({
      query: query.trim(),
      translatedQuery: (translatedQuery || '').trim(),
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
export function clearSearchHistory() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
}
