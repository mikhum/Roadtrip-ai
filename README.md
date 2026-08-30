# AIRoadtrip 🗺️ ✨

> Modern, AI-powered spatial road trip & local place discovery web application. Draw custom freehand search areas on Google Maps and find the best hotels, restaurants, viewpoints, and hidden gems using Google Gemini AI and Google Places API (New).

---

## 🌟 Key Features

- ✏️ **Freehand Search Area Drawing**: Draw any custom polygon or boundary on Google Maps to restrict searches precisely to your route or destination.
- 🧠 **Gemini AI Query Optimization**: Translates natural language questions (e.g., *"Cozy boutique hotels with EV charging and scenic views"*) into optimal Google Places Text Search queries.
- 📍 **Google Places API (New)**: Searches for places within the drawn polygon using rich field masks (photos, ratings, price levels, operating hours, addresses).
- 📋 **Collapsible Place List Sidebar**: Interactive side panel with place cards synced bi-directionally with map markers and rich InfoWindows.
- ⭐ **Live Rating Filter**: Instantly filter displayed places by minimum rating (1.0★ – 5.0★) with zero additional API requests.
- 🎙️ **Voice Search (Web Speech API)**: Hands-free query input with real-time audio pulse feedback.
- 🕒 **Search History**: Saves your last 5 searches in `localStorage` for instant 1-click re-runs.
- ☁️ **Google Drive API Key Sync**: Securely store and retrieve your Google API key to/from your private Google Drive App Data folder.
- 🎯 **Location Jump Autocomplete**: Rapidly pan and zoom to any city or region before drawing.
- 📍 **Live Geolocation**: Center the map on your exact GPS coordinates with a single click.
- 🎨 **Modern UI & Custom Map Styling**: Clean, uncluttered map design (removes POI clutter) with glassmorphism dialogs and toast notifications.

---

## 📁 Project Structure

```
AIRoadtrip/
├── index.html          # Main HTML5 application shell
├── css/
│   └── styles.css      # Custom design system (variables, animations, InfoWindows)
├── js/
│   ├── app.js          # App bootstrap, Google Drive sync, toasts & state coordinator
│   ├── map.js          # Google Maps loader, custom styling, autocomplete & geolocation
│   ├── draw.js         # Freehand polygon drawing mode & coordinate projection
│   ├── search.js       # Gemini AI query optimization, Places API & search history
│   ├── markers.js      # Marker management, InfoWindows, rating filters & sidebar sync
│   └── voice.js        # Web Speech API voice input controller
└── README.md           # Project documentation
```

---

## 🚀 Getting Started

### 1. Prerequisites & Google Cloud Setup
You will need a Google Cloud API key with the following APIs enabled:
1. **Maps JavaScript API** (for rendering the interactive map and drawing overlay)
2. **Places API (New)** (for spatial text searches and place details)
3. **Generative Language API** (for Gemini AI query optimization)

### 2. Running Locally
Simply serve the directory with any local static HTTP server (ES modules require HTTP/HTTPS origin):

```bash
# Using Python
python -m http.server 8000

# Or using Node.js / npx
npx serve .
```

Open `http://localhost:8000` in your web browser.

### 3. Adding Your API Key
1. Click the **Settings** gear icon in the top header.
2. Enter your Google Cloud API key.
3. (Optional) Use the **Google Drive Sync** buttons to save or load your key across devices securely.
4. Click **Save & Start Map**.

---

## 🛠️ Technology Stack

- **Frontend**: Vanilla JavaScript (ES6+ Modules), HTML5, Tailwind CSS CDN + Vanilla CSS Design Tokens
- **Mapping**: Google Maps JavaScript API (v=weekly, geometry & places libraries)
- **AI / LLM**: Google Gemini 2.5 Flash / Generative Language API
- **Places Data**: Google Places API (New) — `https://places.googleapis.com/v1/places:searchText`
- **Cloud Sync**: Google API Client (`gapi`) + Google Identity Services (`gis`) OAuth2
- **Voice Recognition**: Web Speech API (`webkitSpeechRecognition`)

---

## 📄 License
MIT License
