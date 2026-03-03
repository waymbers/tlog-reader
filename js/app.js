/**
 * TLog Reader — Main application controller.
 *
 * State machine:
 *   'upload'     → drag-drop / file-picker zone
 *   'processing' → binary parsing + AI narrative generation
 *   'results'    → tabbed dashboard
 */

import { parseTlog }          from './parser.js';
import { generateNarrative }  from './openai.js';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_FILES = 20;

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  restoreApiKey();
  bindSettings();
  bindUploadZone();
});

// ── API-key settings panel ───────────────────────────────────────────────────

function restoreApiKey() {
  const key = sessionStorage.getItem('openai_api_key') ?? '';
  document.getElementById('apiKeyInput').value = key;
  updateKeyStatus(key);
}

function bindSettings() {
  document.getElementById('settingsToggle').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.toggle('hidden');
  });

  document.getElementById('saveKeyBtn').addEventListener('click', () => {
    const val = document.getElementById('apiKeyInput').value.trim();
    if (val) {
      sessionStorage.setItem('openai_api_key', val);
      updateKeyStatus(val);
      showToast('API key saved for this session ✓');
    } else {
      sessionStorage.removeItem('openai_api_key');
      updateKeyStatus('');
      showToast('API key cleared', 'warn');
    }
  });

  // Also save on Enter
  document.getElementById('apiKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('saveKeyBtn').click();
  });
}

function updateKeyStatus(key) {
  const el = document.getElementById('keyStatus');
  if (key && key.startsWith('sk-')) {
    el.textContent = '● Key configured';
    el.className = 'text-xs text-emerald-400';
  } else if (key) {
    el.textContent = '● Key set (unusual format)';
    el.className = 'text-xs text-yellow-400';
  } else {
    el.textContent = '● No key — AI narratives disabled';
    el.className = 'text-xs text-red-400';
  }
}

// ── Upload zone ──────────────────────────────────────────────────────────────

function bindUploadZone() {
  const zone    = document.getElementById('uploadZone');
  const input   = document.getElementById('fileInput');
  const btn     = document.getElementById('browseBtn');

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleFiles(input.files));

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('border-teal-400', 'bg-slate-700/50');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('border-teal-400', 'bg-slate-700/50');
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('border-teal-400', 'bg-slate-700/50');
    handleFiles(e.dataTransfer.files);
  });
}

async function handleFiles(rawFiles) {
  const files = [...rawFiles]
    .filter(f => f.name.toLowerCase().endsWith('.tlog'))
    .slice(0, MAX_FILES);

  if (files.length === 0) {
    showToast('No .tlog files found in selection', 'error');
    return;
  }
  if (rawFiles.length > MAX_FILES) {
    showToast(`Only the first ${MAX_FILES} files will be processed`, 'warn');
  }

  showView('processing');
  const flights = await processFiles(files);
  renderResults(flights);
  showView('results');
}

// ── Processing pipeline ──────────────────────────────────────────────────────

async function processFiles(files) {
  const total   = files.length;
  const flights = [];

  setProgress(0, total, 'Parsing binary files…');

  // Step 1 — parse all files sequentially
  for (let i = 0; i < files.length; i++) {
    setProgress(i, total, `Parsing ${files[i].name}…`);
    const buffer = await readFileAsBuffer(files[i]);
    const data   = parseTlog(buffer);
    flights.push({ filename: files[i].name, data, narrative: null, error: null });
    setProgress(i + 1, total, `Parsed ${i + 1}/${total} files`);
  }

  // Step 2 — generate AI narratives (one at a time to avoid rate-limiting)
  const hasKey = !!sessionStorage.getItem('openai_api_key');
  if (hasKey) {
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i];
      setProgress(
        i, total,
        `Generating AI report ${i + 1}/${total}: ${f.filename}…`,
        'ai'
      );
      try {
        f.narrative = await generateNarrative(f.data, f.filename);
      } catch (err) {
        f.error = err.message;
      }
    }
  }

  setProgress(total, total, 'Done!');
  return flights;
}

function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Cannot read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

function setProgress(done, total, label, phase = 'parse') {
  const pct   = total ? Math.round((done / total) * 100) : 0;
  const bar   = document.getElementById('progressBar');
  const lbl   = document.getElementById('progressLabel');
  const sub   = document.getElementById('progressSub');

  bar.style.width = `${pct}%`;
  bar.className   = phase === 'ai'
    ? 'h-full bg-purple-500 transition-all duration-500 rounded-full'
    : 'h-full bg-teal-500 transition-all duration-500 rounded-full';
  lbl.textContent = `${pct}%`;
  sub.textContent = label;
}

// ── Results rendering ────────────────────────────────────────────────────────

function renderResults(flights) {
  // Pre-create tab panels so getElementById works in render helpers
  const panelContainer = document.getElementById('tabPanels');
  flights.forEach((_, idx) => {
    if (!document.getElementById(`tab-${idx}`)) {
      const div = document.createElement('div');
      div.id = `tab-${idx}`;
      div.className = 'tab-panel hidden';
      panelContainer.appendChild(div);
    }
  });

  renderTabs(flights);
  renderMasterSummary(flights);
  flights.forEach((f, idx) => renderFlightTab(f, idx));
  activateTab('tab-master');
}

function renderTabs(flights) {
  const nav = document.getElementById('tabNav');
  nav.innerHTML = `
    <button data-tab="tab-master"
      class="tab-btn px-4 py-2 rounded-t-lg font-semibold text-sm bg-teal-600 text-white">
      📊 Summary
    </button>
    ${flights.map((f, i) => `
      <button data-tab="tab-${i}"
        class="tab-btn px-4 py-2 rounded-t-lg font-semibold text-sm bg-slate-700 text-slate-300 hover:bg-slate-600">
        ✈ ${escHtml(truncate(f.filename, 20))}
      </button>
    `).join('')}
  `;
  nav.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function activateTab(id) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === id;
    b.className = active
      ? 'tab-btn px-4 py-2 rounded-t-lg font-semibold text-sm bg-teal-600 text-white'
      : 'tab-btn px-4 py-2 rounded-t-lg font-semibold text-sm bg-slate-700 text-slate-300 hover:bg-slate-600';
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== id);
  });
}

// ── Master Summary ───────────────────────────────────────────────────────────

function renderMasterSummary(flights) {
  const panel = document.getElementById('tab-master');
  const totalSec   = flights.reduce((s, f) => s + f.data.durationSeconds, 0);
  const maxAlt     = Math.max(...flights.map(f => f.data.maxAltitude));
  const maxSpd     = Math.max(...flights.map(f => f.data.maxSpeed));
  const allWarns   = flights.flatMap(f => f.data.statusMessages);
  const totalPkts  = flights.reduce((s, f) => s + f.data.packetCount, 0);

  // Most-common warning text
  const warnCounts = {};
  allWarns.forEach(w => { warnCounts[w.text] = (warnCounts[w.text] ?? 0) + 1; });
  const topWarn = Object.entries(warnCounts).sort((a, b) => b[1] - a[1])[0];

  panel.innerHTML = `
    <div class="p-6">
      <h2 class="text-2xl font-bold text-white mb-6">Mission Summary</h2>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        ${statCard('Total Flights', flights.length, '✈')}
        ${statCard('Total Flight Time', fmtDuration(totalSec), '⏱')}
        ${statCard('Max Altitude', `${maxAlt.toFixed(1)} m`, '📡')}
        ${statCard('Max Speed', `${maxSpd.toFixed(1)} m/s`, '💨')}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        ${statCard('Total Warnings', allWarns.length, '⚠', allWarns.length > 0 ? 'yellow' : 'green')}
        ${statCard('MAVLink Packets', totalPkts.toLocaleString(), '📦')}
        ${topWarn ? statCard('Most Common Issue', `"${truncate(topWarn[0], 35)}" (×${topWarn[1]})`, '🔁', 'red') : ''}
      </div>

      <h3 class="text-lg font-semibold text-slate-300 mb-3">All Flights at a Glance</h3>
      <div class="space-y-2">
        ${flights.map((f, i) => `
          <div class="flex items-center justify-between bg-slate-700 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-600 transition"
               onclick="document.querySelector('[data-tab=tab-${i}]').click()">
            <span class="text-white font-medium">✈ ${escHtml(f.filename)}</span>
            <div class="flex gap-4 text-sm text-slate-400">
              <span>${fmtDuration(f.data.durationSeconds)}</span>
              <span>${f.data.maxAltitude.toFixed(1)} m</span>
              <span class="${f.data.statusMessages.length > 0 ? 'text-yellow-400' : 'text-emerald-400'}">
                ${f.data.statusMessages.length} warning${f.data.statusMessages.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Individual Flight Tab ────────────────────────────────────────────────────

function renderFlightTab(flight, idx) {
  const panel = document.getElementById(`tab-${idx}`);
  const d = flight.data;
  const battDelta = d.batteryStart !== null && d.batteryEnd !== null
    ? `${d.batteryStart}% → ${d.batteryEnd}%`
    : 'N/A';

  panel.innerHTML = `
    <div class="p-6">
      <h2 class="text-2xl font-bold text-white mb-1">${escHtml(flight.filename)}</h2>
      <p class="text-slate-400 text-sm mb-6">${d.packetCount.toLocaleString()} MAVLink packets decoded</p>

      <!-- AI Narrative -->
      <div class="bg-slate-700 rounded-xl p-5 mb-6 border border-slate-600">
        <h3 class="text-lg font-semibold text-teal-400 mb-3">🤖 AI Flight Analysis</h3>
        ${flight.narrative
          ? `<div class="prose prose-invert prose-sm max-w-none text-slate-200 whitespace-pre-wrap leading-relaxed">${escHtml(flight.narrative)}</div>`
          : flight.error
            ? `<p class="text-red-400 italic">AI analysis unavailable: ${escHtml(flight.error)}</p>`
            : `<p class="text-slate-400 italic">AI analysis not requested (no API key configured).</p>`
        }
      </div>

      <!-- Metrics grid -->
      <h3 class="text-lg font-semibold text-slate-300 mb-3">📈 Key Metrics</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        ${statCard('Duration',       fmtDuration(d.durationSeconds), '⏱')}
        ${statCard('Max Altitude',   `${d.maxAltitude.toFixed(1)} m<br><span class="text-xs text-slate-400">${(d.maxAltitude * 3.28084).toFixed(1)} ft</span>`, '📡')}
        ${statCard('Max Speed',      `${d.maxSpeed.toFixed(1)} m/s<br><span class="text-xs text-slate-400">${(d.maxSpeed * 2.237).toFixed(1)} mph</span>`, '💨')}
        ${statCard('Avg Speed',      `${d.avgSpeed.toFixed(1)} m/s`, '📊')}
        ${statCard('Battery',        battDelta, '🔋')}
        ${statCard('Avg Altitude',   `${d.avgAltitude.toFixed(1)} m`, '🏔')}
        ${statCard('Mode Changes',   d.modeChanges.length, '🔄')}
        ${statCard('Warnings',       d.statusMessages.length, '⚠', d.statusMessages.length > 0 ? 'yellow' : 'green')}
      </div>

      <!-- Event Timeline -->
      <h3 class="text-lg font-semibold text-slate-300 mb-3">🗒 Event Timeline</h3>
      <div class="space-y-1 max-h-96 overflow-y-auto pr-1">
        ${buildTimeline(d)}
      </div>
    </div>
  `;
}

function buildTimeline(d) {
  const t0 = d.startTimestamp;

  const events = [
    ...d.modeChanges.map(e => ({
      time: e.time,
      icon: '🔄',
      color: 'text-blue-400',
      label: `Mode → ${e.mode}${e.armed ? ' (Armed)' : ' (Disarmed)'}`,
    })),
    ...d.armedEvents.map(e => ({
      time: e.time,
      icon: e.armed ? '🟢' : '🔴',
      color: e.armed ? 'text-emerald-400' : 'text-slate-400',
      label: e.armed ? `Armed in ${e.mode}` : 'Disarmed',
    })),
    ...d.statusMessages.map(e => ({
      time: e.time,
      icon: e.severity <= 2 ? '🚨' : e.severity <= 3 ? '❌' : '⚠',
      color: e.severity <= 2 ? 'text-red-400' : e.severity <= 3 ? 'text-orange-400' : 'text-yellow-400',
      label: `[${e.severityLabel}] ${e.text}`,
    })),
  ].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  if (events.length === 0) {
    return '<p class="text-slate-500 italic text-sm">No events recorded.</p>';
  }

  return events.map(ev => `
    <div class="flex items-start gap-3 bg-slate-700/50 rounded px-3 py-2 text-sm">
      <span class="mt-0.5">${ev.icon}</span>
      <span class="text-slate-400 font-mono min-w-[52px]">${fmtElapsed(ev.time, t0)}</span>
      <span class="${ev.color}">${escHtml(ev.label)}</span>
    </div>
  `).join('');
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function showView(name) {
  ['upload', 'processing', 'results'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
  });
}

function statCard(label, value, icon, accent = 'teal') {
  const colours = {
    teal:   'bg-teal-900/40 border-teal-700',
    green:  'bg-emerald-900/40 border-emerald-700',
    yellow: 'bg-yellow-900/40 border-yellow-700',
    red:    'bg-red-900/40 border-red-700',
  };
  const cls = colours[accent] ?? colours.teal;
  return `
    <div class="rounded-xl border p-4 ${cls}">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="text-lg font-bold text-white leading-tight">${value}</div>
      <div class="text-xs text-slate-400 mt-1">${label}</div>
    </div>
  `;
}

function showToast(msg, level = 'ok') {
  const colours = { ok: 'bg-teal-700', warn: 'bg-yellow-700', error: 'bg-red-700' };
  const t = document.createElement('div');
  t.className = `fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-white text-sm shadow-lg ${colours[level] ?? colours.ok}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function fmtDuration(secs) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtElapsed(ts, t0) {
  if (!ts || !t0) return 'T+?';
  const sec = Math.max(0, Math.round((ts - t0) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `T+${m}:${String(s).padStart(2, '0')}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
