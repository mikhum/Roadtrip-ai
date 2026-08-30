/**
 * AIRoadtrip — Main Application Coordinator
 * Bootstraps the application, coordinates Google Maps, Gemini AI,
 * Google Drive OAuth sync, search history, toasts, and UI interactions.
 */

import { loadGoogleMapsScript, initMap, getMap, getInfoWindow, setupLocationAutocomplete, jumpToLocation, geolocateUser } from './map.js';
import { initDrawing, activateDrawMode, clearCurrentPolygon, getCurrentPolygon, hasPolygon } from './draw.js';
import { optimizeQueryWithGemini, searchPlacesInPolygon, getSearchHistory, saveSearchToHistory, clearSearchHistory } from './search.js';
import { initMarkers, setApiKey, setPlaces, clearMarkers, applyFilters } from './markers.js';
import VoiceInputController from './voice.js';

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

export function showToast(message, type = 'info', duration = 3500) {
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

export function toggleSettingsModal(force = null) {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  if (force === true) modal.classList.remove('hidden');
  else if (force === false) modal.classList.add('hidden');
  else modal.classList.toggle('hidden');
}

export function toggleSidebar(force = null) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  if (force === true) sidebar.classList.remove('sidebar-collapsed');
  else if (force === false) sidebar.classList.add('sidebar-collapsed');
  else sidebar.classList.toggle('sidebar-collapsed');
}

export function saveSettingsAndStart() {
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
  if (!apiKey) {
    toggleSettingsModal(true);
    return;
  }

  const overlay = document.getElementById('mapOverlay');
  const overlayText = document.getElementById('overlayText');

  try {
    if (overlay) overlay.classList.remove('hidden');
    if (overlayText) overlayText.innerText = 'Loading modern map…';

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
    if (overlayText) {
      overlayText.className = 'text-red-500 font-bold';
      overlayText.innerText = 'Failed to load Google Maps. Please check your API key.';
    }
    showToast('Failed to load Google Maps. Please verify your API key in Settings.', 'error', 6000);
    toggleSettingsModal(true);
  }
}

// ==========================================================================
// Search Operations
// ==========================================================================

export async function triggerAiSearch() {
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

export function handleStartDraw() {
  if (!getMap() || !apiKey) {
    showToast('Please enter your Google API key in Settings first.', 'warning');
    toggleSettingsModal(true);
    return;
  }
  activateDrawMode();
  showToast('Click and drag across the map to outline your search area.', 'info');
}

export function handleClearArea() {
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

export function toggleDrawer(open) {
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

export function setVoiceLanguage(lang, notify = true) {
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
