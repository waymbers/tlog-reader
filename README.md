# TLog Reader 🚁

> **"Explain It Like I'm 5" flight log analysis for normal people.**

TLog Reader is an **offline-first, browser-based** web application that converts
MAVLink `.tlog` files (ArduPilot / PX4 telemetry records) into plain-English
incident reports — no Mission Planner or QGroundControl knowledge required.

---

## Features

- 📂 **Multi-file upload** — drag-and-drop up to 20 `.tlog` files at once.
- 🔍 **Browser-side binary parser** — decodes MAVLink v1 & v2 packets entirely
  in your browser using `FileReader` + `DataView`; no data leaves your machine.
- 🤖 **AI-powered ELI5 narratives** — sends lightweight extracted metrics (not
  raw binary) to the OpenAI API to generate friendly, jargon-free flight reports.
- 📊 **Unified Summary Dashboard** — aggregated stats across all uploaded flights.
- ✈ **Individual Flight Tabs** — metrics grid, event timeline, and the AI
  narrative for every flight.

---

## Providing your OpenAI API Key

TLog Reader uses [OpenAI's](https://openai.com/) `gpt-4o-mini` model to generate
the human-readable narratives.  You need to supply your own API key.

**Step-by-step:**

1. Go to **[platform.openai.com/api-keys](https://platform.openai.com/api-keys)**.
2. Sign in (or create a free account).
3. Click **"Create new secret key"**, give it a name, and copy the key — it
   starts with `sk-…`.
4. Open TLog Reader in your browser, click the **⚙ Settings** button in the top
   right corner.
5. Paste the key into the **OpenAI API Key** field and click **Save**.

> **Security note:** the key is stored only in your browser's `sessionStorage`
> for the current tab session.  It is automatically cleared when you close the
> tab and is **never sent to any server other than `api.openai.com`**.

If you skip this step the app still works — you get all the parsed metrics and
the event timeline; only the AI-generated narrative is skipped.

---

## How to Run

TLog Reader is a static web app — no build step, no Node server.

```bash
# Option A — any static HTTP server (required for ES module imports)
npx serve .
# then open http://localhost:3000

# Option B — Python
python -m http.server 8080
# then open http://localhost:8080

# Option C — VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

> **Note:** you must serve the files over HTTP (even `localhost`).  Opening
> `index.html` directly as a `file://` URL will block ES module imports.

---

## Technical Architecture

| Layer | Technology |
|---|---|
| UI | Vanilla HTML + [Tailwind CSS](https://tailwindcss.com/) (CDN) |
| Binary parsing | `FileReader` + `ArrayBuffer` + `DataView` |
| AI narratives | OpenAI `gpt-4o-mini` REST API |
| Hosting | Any static file server / GitHub Pages |

### Packets decoded

| MsgID | Name | Extracted fields |
|---|---|---|
| 0 | `HEARTBEAT` | Flight mode, armed/disarmed status |
| 1 | `SYS_STATUS` | Battery remaining (%) |
| 33 | `GLOBAL_POSITION_INT` | Relative altitude (mm) |
| 74 | `VFR_HUD` | Ground speed (m/s) |
| 253 | `STATUSTEXT` | Severity ≤ 4 warnings |

---

## File Structure

```
tlog-reader/
├── index.html        # Main HTML shell (Tailwind, three-view layout)
├── js/
│   ├── app.js        # UI state machine, processing pipeline, rendering
│   ├── parser.js     # MAVLink v1/v2 binary byte-scanner
│   └── openai.js     # OpenAI chat-completions REST client
└── README.md
```

---

## License

MIT

