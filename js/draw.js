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
export function initDrawing(map, container, cbs = {}) {
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
export function activateDrawMode() {
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
export function deactivateDrawMode() {
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
export function clearCurrentPolygon() {
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
export function getCurrentPolygon() {
  return currentPolygon;
}

/**
 * Returns whether a polygon currently exists on the map.
 * @returns {boolean}
 */
export function hasPolygon() {
  return currentPolygon !== null;
}

/**
 * Returns whether draw mode is currently enabled.
 * @returns {boolean}
 */
export function isDrawing() {
  return isModeEnabled;
}
