/**
 * app.js — Main application logic for TLog Reader
 *
 * Wires up the upload UI, orchestrates parsing + AI generation,
 * and renders the dashboard.
 */

(() => {
  'use strict';

  /* ── DOM References ── */
  const viewUpload     = document.getElementById('view-upload');
  const viewProcessing = document.getElementById('view-processing');
  const viewDashboard  = document.getElementById('view-dashboard');
  const dropZone       = document.getElementById('drop-zone');
  const fileInput      = document.getElementById('file-input');
  const progressBar    = document.getElementById('progress-bar');
  const progressLabel  = document.getElementById('progress-label');
  const processingStatus = document.getElementById('processing-status');
  const tabBar         = document.getElementById('tab-bar');
  const tabContent     = document.getElementById('tab-content');

  // API Key modal
  const modalApiKey  = document.getElementById('modal-api-key');
  const btnApiKey    = document.getElementById('btn-api-key');
  const btnSaveKey   = document.getElementById('btn-save-key');
  const btnCancelKey = document.getElementById('btn-cancel-key');
  const inputApiKey  = document.getElementById('input-api-key');

  /* ── State ── */
  let flightReports = [];        // parsed reports
  let narratives    = {};        // filename → AI narrative
  let masterNarrative = '';
  let activeTab     = 'summary'; // 'summary' | filename

  /* ══════════════════════════════════════════
     API Key Modal
     ══════════════════════════════════════════ */
  btnApiKey.addEventListener('click', () => {
    inputApiKey.value = FlightAI.getApiKey() || '';
    modalApiKey.classList.remove('hidden');
  });

  btnCancelKey.addEventListener('click', () => {
    modalApiKey.classList.add('hidden');
  });

  btnSaveKey.addEventListener('click', () => {
    const key = inputApiKey.value.trim();
    if (key) {
      FlightAI.setApiKey(key);
    }
    modalApiKey.classList.add('hidden');
  });

  // Close modal on backdrop click
  modalApiKey.addEventListener('click', (e) => {
    if (e.target === modalApiKey) modalApiKey.classList.add('hidden');
  });

  /* ══════════════════════════════════════════
     File Upload
     ══════════════════════════════════════════ */
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.toLowerCase().endsWith('.tlog')
    );
    if (files.length > 0) handleFiles(files);
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    if (files.length > 0) handleFiles(files);
  });

  /* ══════════════════════════════════════════
     Processing Pipeline
     ══════════════════════════════════════════ */
  async function handleFiles(files) {
    if (files.length > 20) {
      alert('Please select up to 20 .tlog files at a time.');
      return;
    }

    showView('processing');
    flightReports = [];
    narratives = {};
    masterNarrative = '';

    const total = files.length;

    // Phase 1: Parse all files
    processingStatus.textContent = 'Parsing flight logs…';
    for (let i = 0; i < total; i++) {
      progressLabel.textContent = `Parsing ${i + 1} / ${total}`;
      progressBar.style.width = `${((i + 0.5) / (total * 2)) * 100}%`;

      const buffer = await readFileAsArrayBuffer(files[i]);
      const report = TLogParser.parse(buffer, files[i].name);
      flightReports.push(report);

      progressBar.style.width = `${((i + 1) / (total * 2)) * 100}%`;
    }

    // Phase 2: AI narrative generation (if API key present)
    if (FlightAI.getApiKey()) {
      processingStatus.textContent = 'Generating AI reports…';
      for (let i = 0; i < flightReports.length; i++) {
        progressLabel.textContent = `AI report ${i + 1} / ${total}`;
        progressBar.style.width = `${((total + i + 0.5) / (total * 2)) * 100}%`;

        try {
          narratives[flightReports[i].filename] = await FlightAI.generateNarrative(flightReports[i]);
        } catch (err) {
          narratives[flightReports[i].filename] = `⚠️ AI generation failed: ${err.message}`;
        }

        progressBar.style.width = `${((total + i + 1) / (total * 2)) * 100}%`;
      }

      // Master summary
      if (flightReports.length > 1) {
        try {
          processingStatus.textContent = 'Generating master summary…';
          masterNarrative = await FlightAI.generateMasterNarrative(flightReports);
        } catch (err) {
          masterNarrative = `⚠️ AI master summary failed: ${err.message}`;
        }
      }
    } else {
      progressBar.style.width = '100%';
    }

    // Phase 3: Render dashboard
    renderDashboard();
    showView('dashboard');
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /* ══════════════════════════════════════════
     View Switching
     ══════════════════════════════════════════ */
  function showView(name) {
    viewUpload.classList.add('hidden');
    viewProcessing.classList.add('hidden');
    viewDashboard.classList.add('hidden');

    if (name === 'upload') viewUpload.classList.remove('hidden');
    if (name === 'processing') viewProcessing.classList.remove('hidden');
    if (name === 'dashboard') viewDashboard.classList.remove('hidden');
  }

  /* ══════════════════════════════════════════
     Dashboard Rendering
     ══════════════════════════════════════════ */
  function renderDashboard() {
    renderTabs();
    renderActivePanel();
  }

  function renderTabs() {
    tabBar.innerHTML = '';

    // Master Summary tab
    const summaryBtn = createTabButton('📊 Summary', 'summary');
    tabBar.appendChild(summaryBtn);

    // Individual flight tabs
    flightReports.forEach((r) => {
      const btn = createTabButton(`✈️ ${r.filename}`, r.filename);
      tabBar.appendChild(btn);
    });

    // "Upload more" button
    const moreBtn = document.createElement('button');
    moreBtn.className = 'tab-btn ml-auto text-indigo-400 hover:text-indigo-300';
    moreBtn.textContent = '+ Upload More';
    moreBtn.addEventListener('click', () => {
      showView('upload');
      fileInput.value = '';
    });
    tabBar.appendChild(moreBtn);
  }

  function createTabButton(label, id) {
    const btn = document.createElement('button');
    btn.className = `tab-btn${activeTab === id ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      activeTab = id;
      renderDashboard();
    });
    return btn;
  }

  function renderActivePanel() {
    if (activeTab === 'summary') {
      tabContent.innerHTML = renderSummaryPanel();
    } else {
      const report = flightReports.find((r) => r.filename === activeTab);
      if (report) {
        tabContent.innerHTML = renderFlightPanel(report);
      }
    }
  }

  /* ── Summary Panel ── */
  function renderSummaryPanel() {
    const totalFlights = flightReports.length;
    const conclusiveFlights = flightReports.filter((r) => r.flightTimeMs !== null);
    const totalTimeMs = conclusiveFlights.reduce((s, r) => s + r.flightTimeMs, 0);
    const maxAlt = Math.max(...flightReports.map((r) => r.maxAltitudeM));
    const maxSpeed = Math.max(...flightReports.map((r) => r.maxGroundspeedMs));

    // Count all events
    const allEvents = flightReports.flatMap((r) => r.events.filter((e) => e.type === 'STATUS'));
    const errorCounts = {};
    allEvents.forEach((e) => {
      errorCounts[e.text] = (errorCounts[e.text] || 0) + 1;
    });
    const topErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const flightTimeLabel = conclusiveFlights.length < totalFlights
      ? formatDuration(totalTimeMs) + ' <span class="text-xs text-yellow-400">(some inconclusive)</span>'
      : formatDuration(totalTimeMs);

    return `
      <div class="max-w-4xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">📊 Master Summary</h2>

        <!-- Metric Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          ${metricCard('Total Flights', String(totalFlights))}
          <div class="metric-card">
            <div class="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Flight Time</div>
            <div class="text-xl font-bold">${flightTimeLabel}</div>
          </div>
          ${metricCard('Peak Altitude', maxAlt.toFixed(1) + ' m')}
          ${metricCard('Peak Speed', maxSpeed.toFixed(1) + ' m/s')}
        </div>

        ${topErrors.length > 0 ? `
        <div class="metric-card mb-8">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-lg font-semibold">Most Common Warnings</h3>
            <span class="badge-raw">Raw Data</span>
          </div>
          <ul class="space-y-2 text-sm">
            ${topErrors.map(([text, count]) =>
              `<li class="flex justify-between"><span class="text-yellow-400">${escapeHtml(text)}</span><span class="text-gray-400">×${count}</span></li>`
            ).join('')}
          </ul>
        </div>` : ''}

        <!-- AI Master Narrative -->
        <div class="metric-card">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-lg font-semibold">🤖 AI Overview</h3>
            <span class="badge-ai">AI Interpretation</span>
          </div>
          <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-line">${
            masterNarrative
              ? escapeHtml(masterNarrative)
              : flightReports.length === 1
                ? '<span class="text-gray-500">Upload multiple flights for a master AI summary, or view the individual flight tab.</span>'
                : '<span class="text-gray-500">No OpenAI API key set. Click 🔑 API Key in the header to enable AI-generated reports.</span>'
          }</div>
        </div>
      </div>
    `;
  }

  /* ── Individual Flight Panel ── */
  function renderFlightPanel(report) {
    const batteryDelta =
      report.batteryStart !== null && report.batteryEnd !== null
        ? report.batteryStart - report.batteryEnd
        : null;

    const narrative = narratives[report.filename];
    const modeList = [...new Set(report.modes.map((m) => m.mode))];
    const flightTimeDisplay = report.flightTimeMs !== null
      ? formatDuration(report.flightTimeMs)
      : '<span class="text-yellow-400 text-sm">Data Inconclusive</span>';

    return `
      <div class="max-w-4xl mx-auto" id="flight-panel-${slugify(report.filename)}">
        <h2 class="text-2xl font-bold mb-1">${escapeHtml(report.filename)}</h2>
        <p class="text-sm text-gray-400 mb-6">${report.packets.toLocaleString()} packets · ${(report.totalBytes / 1024).toFixed(0)} KB</p>

        <!-- Metric Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div class="metric-card">
            <div class="text-xs text-gray-400 uppercase tracking-wide mb-1">Flight Time</div>
            <div class="text-xl font-bold">${flightTimeDisplay}</div>
          </div>
          ${metricCard('Max Altitude', report.maxAltitudeM.toFixed(1) + ' m')}
          ${metricCard('Max Speed', report.maxGroundspeedMs.toFixed(1) + ' m/s')}
          ${metricCard('Battery Used', batteryDelta !== null ? batteryDelta + '%' : 'N/A')}
        </div>

        ${report.batteryStart !== null ? `
        <div class="grid grid-cols-2 gap-4 mb-8">
          ${metricCard('Battery Start', report.batteryStart + '%')}
          ${metricCard('Battery End', report.batteryEnd + '%')}
        </div>` : ''}

        ${modeList.length > 0 ? `
        <div class="metric-card mb-8">
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-lg font-semibold">Flight Modes Used</h3>
            <span class="badge-raw">Raw Data</span>
          </div>
          <div class="flex flex-wrap gap-2">
            ${modeList.map((m) => `<span class="bg-indigo-900/50 text-indigo-300 px-3 py-1 rounded-full text-sm">${escapeHtml(m)}</span>`).join('')}
          </div>
        </div>` : ''}

        ${renderAltChart(report)}

        <!-- AI Structured Narrative -->
        ${renderAiNarrative(report.filename, narrative)}

        <!-- Technical Details Toggle -->
        <div class="mb-8">
          <button class="raw-toggle-btn" onclick="toggleRawStream('${slugify(report.filename)}')">
            📡 View Raw MAVLink Stream
          </button>
          <div id="raw-stream-${slugify(report.filename)}" class="raw-stream-panel hidden mt-4">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-base font-semibold">Raw MAVLink Event Stream</h3>
              <span class="badge-raw">Raw Data</span>
            </div>
            <p class="text-xs text-gray-500 mb-3">Chronological list of all STATUSTEXT, mode changes, and arm/disarm events parsed from the log.</p>
            <div class="space-y-0 raw-event-list">
              ${report.rawEvents.length > 0
                ? report.rawEvents.map((e) => {
                    const sevClass = e.severity !== undefined ? `severity-${(e.severityLabel || '').toLowerCase()}` : '';
                    const typeColor = e.type === 'ARM' ? 'text-green-400' : e.type === 'DISARM' ? 'text-red-400' : e.type === 'MODE' ? 'text-indigo-400' : '';
                    return `<div class="event-item">
                      <div class="text-xs ${typeColor || 'text-gray-500'}">${e.type}${e.severityLabel ? ' · ' + e.severityLabel : ''}</div>
                      <div class="text-sm ${sevClass || 'text-gray-300'}">${escapeHtml(e.text)}</div>
                    </div>`;
                  }).join('')
                : '<p class="text-sm text-gray-500">No events recorded in this log.</p>'
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ── AI Narrative Renderer ── */
  function renderAiNarrative(filename, narrative) {
    if (!narrative) {
      return `
        <div class="metric-card mb-8">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-lg font-semibold">🤖 AI Flight Report</h3>
            <span class="badge-ai">AI Interpretation</span>
          </div>
          <p class="text-sm text-gray-500">No OpenAI API key set. Click 🔑 API Key in the header to enable AI-generated reports.</p>
        </div>`;
    }

    // Structured JSON narrative
    if (typeof narrative === 'object' && !narrative._raw) {
      const pairs = Array.isArray(narrative.problemFixPairs) ? narrative.problemFixPairs : [];
      return `
        <div class="metric-card mb-8">
          <div class="flex items-center gap-2 mb-4">
            <h3 class="text-lg font-semibold">🤖 AI Flight Report</h3>
            <span class="badge-ai">AI Interpretation</span>
          </div>

          ${narrative.overview ? `
          <div class="ai-section mb-4">
            <div class="ai-section-title">📋 Overview</div>
            <p class="text-sm text-gray-200 leading-relaxed">${escapeHtml(narrative.overview)}</p>
          </div>` : ''}

          ${narrative.theGood ? `
          <div class="ai-section mb-4">
            <div class="ai-section-title text-green-400">✅ What Went Well</div>
            <p class="text-sm text-gray-200 leading-relaxed whitespace-pre-line">${escapeHtml(narrative.theGood)}</p>
          </div>` : ''}

          ${narrative.theBad ? `
          <div class="ai-section mb-4">
            <div class="ai-section-title text-yellow-400">⚠️ What Went Wrong</div>
            <p class="text-sm text-gray-200 leading-relaxed whitespace-pre-line">${escapeHtml(narrative.theBad)}</p>
          </div>` : ''}

          ${narrative.howToFix ? `
          <div class="ai-section mb-4">
            <div class="ai-section-title text-indigo-400">🔧 How to Fix It</div>
            <p class="text-sm text-gray-200 leading-relaxed whitespace-pre-line">${escapeHtml(narrative.howToFix)}</p>
          </div>` : ''}

          ${pairs.length > 0 ? `
          <div class="ai-section">
            <div class="ai-section-title text-orange-400">🩺 Problem / Fix Pairs</div>
            <div class="space-y-2 mt-2">
              ${pairs.map((p) => `
              <div class="problem-fix-pair">
                <div class="problem-label">Problem: <span class="text-red-300">${escapeHtml(p.problem || '')}</span></div>
                <div class="fix-label">Fix: <span class="text-green-300">${escapeHtml(p.fix || '')}</span></div>
              </div>`).join('')}
            </div>
          </div>` : ''}
        </div>`;
    }

    // Fallback: raw text narrative
    const text = narrative._raw || (typeof narrative === 'string' ? narrative : JSON.stringify(narrative));
    return `
      <div class="metric-card mb-8">
        <div class="flex items-center gap-2 mb-3">
          <h3 class="text-lg font-semibold">🤖 AI Flight Report</h3>
          <span class="badge-ai">AI Interpretation</span>
        </div>
        <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-line">${escapeHtml(text)}</div>
      </div>`;
  }

  /* ── Altitude Chart (inline SVG) ── */
  function renderAltChart(report) {
    const history = report.altHistory;
    if (!history || history.length < 2) return '';

    const W = 600, H = 120, PAD = 30;
    const minAlt = 0;
    const maxAlt = Math.max(...history.map((p) => p.alt), 1);
    const minT = history[0].time;
    const maxT = history[history.length - 1].time;
    const rangeT = maxT - minT || 1;

    const toX = (t) => PAD + ((t - minT) / rangeT) * (W - PAD * 2);
    const toY = (a) => H - PAD - ((a - minAlt) / (maxAlt - minAlt)) * (H - PAD * 2);

    const points = history.map((p) => `${toX(p.time).toFixed(1)},${toY(p.alt).toFixed(1)}`).join(' ');
    const areaPoints = `${toX(minT).toFixed(1)},${(H - PAD).toFixed(1)} ${points} ${toX(maxT).toFixed(1)},${(H - PAD).toFixed(1)}`;

    return `
      <div class="metric-card mb-8">
        <div class="flex items-center gap-2 mb-3">
          <h3 class="text-base font-semibold">Altitude Over Time</h3>
          <span class="badge-raw">Raw Data</span>
        </div>
        <div class="alt-chart-container">
          <svg viewBox="0 0 ${W} ${H}" class="w-full" preserveAspectRatio="none" aria-label="Altitude chart">
            <!-- Area fill -->
            <polygon points="${areaPoints}" fill="rgba(99,102,241,0.15)" />
            <!-- Line -->
            <polyline points="${points}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" />
            <!-- Y labels -->
            <text x="${PAD - 4}" y="${toY(maxAlt).toFixed(1)}" fill="#9ca3af" font-size="9" text-anchor="end" dominant-baseline="middle">${maxAlt.toFixed(0)}m</text>
            <text x="${PAD - 4}" y="${(H - PAD).toFixed(1)}" fill="#9ca3af" font-size="9" text-anchor="end" dominant-baseline="middle">0m</text>
          </svg>
        </div>
      </div>`;
  }

  /* ── Toggle Raw Stream ── */
  window.toggleRawStream = function(slug) {
    const panel = document.getElementById(`raw-stream-${slug}`);
    const btn = panel && panel.previousElementSibling;
    if (!panel) return;
    const isHidden = panel.classList.toggle('hidden');
    if (btn) btn.textContent = isHidden ? '📡 View Raw MAVLink Stream' : '📡 Hide Raw MAVLink Stream';
  };

  /* ── UI Helpers ── */
  function slugify(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
  }

  function metricCard(label, value) {
    return `
      <div class="metric-card">
        <div class="text-xs text-gray-400 uppercase tracking-wide mb-1">${escapeHtml(label)}</div>
        <div class="text-xl font-bold">${typeof value === 'string' ? value : escapeHtml(String(value))}</div>
      </div>
    `;
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined || ms <= 0) return '0s';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
