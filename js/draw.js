/**
 * AIRoadtrip — Freehand Polygon Drawing Module (Leaflet Engine)
 * Smooth mouse, pen, and multi-touch freehand search boundary drawing.
 */

let mapInstance = null;
let mapContainer = null;
let currentPolygon = null;
let currentPoints = [];
let freehandPolyline = null;
let isDrawingActive = false;
let isModeEnabled = false;

let callbacks = {
  onDrawStart: () => {},
  onDrawComplete: (polygon) => {},
  onDrawCancel: () => {}
};

/**
 * Initialize the drawing module with Leaflet map and container references.
 * @param {L.Map} map 
 * @param {HTMLElement} container 
 * @param {Object} cbs 
 */
export function initDrawing(map, container, cbs = {}) {
  mapInstance = map;
  mapContainer = typeof container === 'string' ? document.getElementById(container) : container;
  callbacks = { ...callbacks, ...cbs };

  // Remove existing listeners if any
  cleanupListeners();
  setupListeners();
}

/**
 * Converts screen/client pixel coordinates to Leaflet LatLng.
 * @param {MouseEvent|TouchEvent|PointerEvent} e 
 * @returns {L.LatLng|null}
 */
function getLatLngFromEvent(e) {
  if (!mapInstance || !mapContainer) return null;

  const rect = mapContainer.getBoundingClientRect();
  const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
  const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;

  if (clientX === undefined || clientY === undefined) return null;

  const containerPoint = L.point(clientX - rect.left, clientY - rect.top);
  return mapInstance.containerPointToLatLng(containerPoint);
}

function handleStart(e) {
  if (!isModeEnabled) return;
  e.preventDefault();

  isDrawingActive = true;
  const latLng = getLatLngFromEvent(e);
  if (!latLng) return;

  currentPoints = [latLng];

  // Remove existing polygon if redrawing
  if (currentPolygon) {
    mapInstance.removeLayer(currentPolygon);
    currentPolygon = null;
  }

  if (freehandPolyline) {
    mapInstance.removeLayer(freehandPolyline);
    freehandPolyline = null;
  }

  callbacks.onDrawStart();
}

function handleMove(e) {
  if (!isModeEnabled || !isDrawingActive) return;
  e.preventDefault();

  const latLng = getLatLngFromEvent(e);
  if (!latLng) return;

  // Don't add duplicate points
  const last = currentPoints[currentPoints.length - 1];
  if (last && Math.abs(last.lat - latLng.lat) < 0.00001 && Math.abs(last.lng - latLng.lng) < 0.00001) {
    return;
  }

  currentPoints.push(latLng);

  if (freehandPolyline) {
    freehandPolyline.setLatLngs(currentPoints);
  } else {
    freehandPolyline = L.polyline(currentPoints, {
      color: '#4f46e5',
      weight: 3,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance);
  }
}

function handleEnd(e) {
  if (!isModeEnabled || !isDrawingActive) return;
  if (e) e.preventDefault();

  isDrawingActive = false;
  deactivateDrawMode();

  if (freehandPolyline) {
    mapInstance.removeLayer(freehandPolyline);
    freehandPolyline = null;
  }

  // Need at least 3 points to form a valid polygon
  if (currentPoints.length < 3) {
    currentPoints = [];
    callbacks.onDrawCancel();
    return;
  }

  // Create closed polygon
  currentPolygon = L.polygon(currentPoints, {
    color: '#4f46e5',
    weight: 2.5,
    opacity: 0.9,
    fillColor: '#4f46e5',
    fillOpacity: 0.18,
    interactive: false
  }).addTo(mapInstance);

  callbacks.onDrawComplete(currentPolygon);
}

function setupListeners() {
  if (!mapContainer) return;

  // Mouse & Touch events
  mapContainer.addEventListener('mousedown', handleStart, { passive: false });
  window.addEventListener('mousemove', handleMove, { passive: false });
  window.addEventListener('mouseup', handleEnd, { passive: false });

  mapContainer.addEventListener('touchstart', handleStart, { passive: false });
  window.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd, { passive: false });
  window.addEventListener('touchcancel', handleEnd, { passive: false });
}

function cleanupListeners() {
  if (!mapContainer) return;
  mapContainer.removeEventListener('mousedown', handleStart);
  window.removeEventListener('mousemove', handleMove);
  window.removeEventListener('mouseup', handleEnd);

  mapContainer.removeEventListener('touchstart', handleStart);
  window.removeEventListener('touchmove', handleMove);
  window.removeEventListener('touchend', handleEnd);
  window.removeEventListener('touchcancel', handleEnd);
}

/**
 * Activates freehand drawing mode and locks map panning.
 */
export function activateDrawMode() {
  if (!mapInstance) return;
  isModeEnabled = true;
  isDrawingActive = false;

  // Disable map navigation so gestures draw instead of panning/zooming
  mapInstance.dragging.disable();
  mapInstance.touchZoom.disable();
  mapInstance.doubleClickZoom.disable();
  mapInstance.scrollWheelZoom.disable();
  mapInstance.boxZoom.disable();
  mapInstance.keyboard.disable();
  if (mapInstance.tap) mapInstance.tap.disable();

  if (mapContainer) {
    mapContainer.style.cursor = 'crosshair';
  }
}

/**
 * Deactivates freehand drawing mode and restores map navigation.
 */
export function deactivateDrawMode() {
  if (!mapInstance) return;
  isModeEnabled = false;
  isDrawingActive = false;

  mapInstance.dragging.enable();
  mapInstance.touchZoom.enable();
  mapInstance.doubleClickZoom.enable();
  mapInstance.scrollWheelZoom.enable();
  mapInstance.boxZoom.enable();
  mapInstance.keyboard.enable();
  if (mapInstance.tap) mapInstance.tap.enable();

  if (mapContainer) {
    mapContainer.style.cursor = '';
  }
}

/**
 * Clears current polygon and path from map.
 */
export function clearCurrentPolygon() {
  if (currentPolygon && mapInstance) {
    mapInstance.removeLayer(currentPolygon);
    currentPolygon = null;
  }
  if (freehandPolyline && mapInstance) {
    mapInstance.removeLayer(freehandPolyline);
    freehandPolyline = null;
  }
  currentPoints = [];
}

/**
 * Returns the currently drawn polygon or null.
 * @returns {L.Polygon|null}
 */
export function getCurrentPolygon() {
  return currentPolygon;
}

/**
 * Returns raw coordinates array [{lat, lng}].
 * @returns {Array<Object>}
 */
export function getPolygonCoordinates() {
  return currentPoints.map(p => ({ lat: p.lat, lng: p.lng }));
}

/**
 * Check if a polygon currently exists.
 * @returns {boolean}
 */
export function hasPolygon() {
  return currentPolygon !== null && currentPoints.length >= 3;
}

/**
 * Ray-casting algorithm to test if a point (lat, lng) is inside the polygon.
 * @param {number} lat 
 * @param {number} lng 
 * @param {Array<Object>} [coords] 
 * @returns {boolean}
 */
export function isPointInPolygon(lat, lng, coords = null) {
  const points = coords || getPolygonCoordinates();
  if (!points || points.length < 3) return true; // If no boundary, allow all

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
