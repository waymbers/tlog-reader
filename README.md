# TLog Reader ✈️

> Drag. Drop. Understand Your Flight.

**TLog Reader** is an offline-first, browser-based web app that turns MAVLink `.tlog` telemetry files into plain-English incident reports — no Mission Planner, no hex editors, no engineering degree required.

---

## ✨ Features

- **Multi-file upload** — drag-and-drop up to 20 `.tlog` files at once
- **100% client-side parsing** — your flight data never leaves your browser
- **Master Summary Dashboard** — aggregated stats across all uploaded flights
- **Individual Flight Tabs** — drill into each mission's metrics and events
- **AI-powered narratives** — OpenAI explains *why* something happened, not just *what*
- **ELI5 reports** — written for hobbyists, commercial pilots, and ops managers

## 🔧 Decoded MAVLink Messages

| MsgID | Name                 | Data Extracted                        |
|-------|----------------------|---------------------------------------|
| 0     | HEARTBEAT            | Flight mode, armed/disarmed status    |
| 1     | SYS_STATUS           | Battery remaining (%)                 |
| 33    | GLOBAL_POSITION_INT  | Relative altitude (m)                 |
| 74    | VFR_HUD              | Groundspeed (m/s)                     |
| 253   | STATUSTEXT           | Warnings and errors (severity ≤ 4)    |

---

## 🚀 Getting Started

### 1. Open the App

No install required — just open `index.html` in any modern browser:

```
# macOS
open index.html

# Linux
xdg-open index.html

# Windows
start index.html
```

Or serve it locally with any static server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

### 2. Set Your OpenAI API Key 🔑

TLog Reader uses the **OpenAI API** (`gpt-4o-mini` model) to generate human-readable flight narratives. You need an OpenAI API key to enable AI reports.

#### How to get your key:

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign in (or create an account)
3. Click **"Create new secret key"**
4. Copy the key (it starts with `sk-`)

#### How to enter it in the app:

1. Click the **🔑 API Key** button in the top-right corner of the app
2. Paste your key into the input field
3. Click **Save**

Your key is stored **only** in your browser's `localStorage` — it is never sent anywhere except directly to the OpenAI API. It persists between sessions so you only need to enter it once.

> **Note:** The app works without an API key — you'll still get all the parsed metrics, event timelines, and dashboards. The AI narrative sections will simply show a prompt to add your key.

### 3. Upload Your .tlog Files

- Drag and drop `.tlog` files onto the upload zone, or click to browse
- The app parses the binary data right in your browser
- If an API key is set, AI narratives are generated automatically

---

## 🏗️ Tech Stack

| Layer       | Technology                                     |
|-------------|------------------------------------------------|
| Frontend    | Vanilla HTML / CSS / JavaScript                |
| Styling     | [Tailwind CSS](https://tailwindcss.com/) (CDN) |
| Parsing     | `FileReader` + `ArrayBuffer` + `DataView`      |
| AI          | [OpenAI API](https://platform.openai.com/)     |
| AI Model    | `gpt-4o-mini`                                  |
| Backend     | **None** — 100% client-side                    |

---

## 📁 Project Structure

```
tlog-reader/
├── index.html        # Main HTML — upload UI, dashboard, modals
├── css/
│   └── styles.css    # Custom styles (beyond Tailwind)
├── js/
│   ├── parser.js     # MAVLink binary .tlog parser
│   ├── ai.js         # OpenAI API integration
│   └── app.js        # Main app logic & UI rendering
└── README.md
```

---

## 🔒 Privacy & Security

- **No server** — everything runs in your browser
- **No data upload** — `.tlog` files are parsed locally via `ArrayBuffer`
- **API key storage** — stored in `localStorage`, never logged or transmitted except to OpenAI
- **AI calls** — only lightweight JSON summaries (not raw binary data) are sent to OpenAI

---

## 📚 References

- [MAVLink Protocol Standard](https://mavlink.io/en/messages/common.html)
- [ArduPilot Copter Flight Modes](https://ardupilot.org/copter/docs/flight-modes.html)
- [OpenAI API Documentation](https://platform.openai.com/docs)
