/**
 * OpenAI chat-completions client for ELI5 flight narrative generation.
 *
 * The user's API key is read from sessionStorage['openai_api_key'].
 * It is never sent anywhere other than api.openai.com.
 */

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL   = 'gpt-4o-mini';

/**
 * Generate a plain-English narrative for one flight's extracted metrics.
 *
 * @param {Object} flightData   - Output of parseTlog()
 * @param {string} filename     - Original filename (for context)
 * @returns {Promise<string>}   - Markdown-formatted narrative
 */
export async function generateNarrative(flightData, filename) {
  const apiKey = sessionStorage.getItem('openai_api_key');
  if (!apiKey) {
    throw new Error(
      'No OpenAI API key found. Please enter your key in the Settings panel.'
    );
  }

  const messages = [
    {
      role: 'system',
      content:
        'You are a friendly, patient drone flight analyst. ' +
        'Your job is to explain flight log data to non-technical people (hobbyists, ' +
        'operations managers) in plain English. Use simple analogies, avoid jargon, ' +
        'and be encouraging while being honest about any concerns. ' +
        'Format your response with clear sections.',
    },
    {
      role: 'user',
      content: buildPrompt(flightData, filename),
    },
  ];

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1200, temperature: 0.7 }),
  });

  if (!resp.ok) {
    let msg = `OpenAI API error ${resp.status}`;
    try {
      const body = await resp.json();
      if (body.error?.message) msg = body.error.message;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '(No narrative returned)';
}

// ── Private helpers ──────────────────────────────────────────────────────────

function buildPrompt(f, filename) {
  const dur = fmtDuration(f.durationSeconds);
  const battDelta = (f.batteryStart !== null && f.batteryEnd !== null)
    ? `${f.batteryStart}% → ${f.batteryEnd}% (used ${f.batteryStart - f.batteryEnd}%)`
    : 'Not available';

  const uniqueModes = [...new Set(f.modeChanges.map(m => m.mode))].join(', ') || 'Unknown';

  const warnLines = f.statusMessages.slice(0, 10)
    .map(m => `  • [${m.severityLabel}] ${m.text}`)
    .join('\n') || '  • None recorded';

  return `
Please write an easy-to-understand flight report for this drone log file.

FILE: ${filename}
DURATION: ${dur}
MAX ALTITUDE: ${f.maxAltitude.toFixed(1)} m (${(f.maxAltitude * 3.28084).toFixed(1)} ft)
MAX SPEED: ${f.maxSpeed.toFixed(1)} m/s (${(f.maxSpeed * 2.237).toFixed(1)} mph)
AVERAGE SPEED: ${f.avgSpeed.toFixed(1)} m/s
BATTERY: ${battDelta}
FLIGHT MODES USED: ${uniqueModes}
MODE CHANGES: ${f.modeChanges.length}
ARMED/DISARMED EVENTS: ${f.armedEvents.length}
CRITICAL WARNINGS (${f.statusMessages.length} total):
${warnLines}

Write three short sections:
1. **How did the flight go?** (2–3 sentences overview)
2. **Any issues to know about?** (explain each warning in plain English — what it means and whether action is needed)
3. **Overall verdict** (one sentence: normal flight, minor concerns, or needs attention?)

Keep the tone friendly and non-technical.
`.trim();
}

function fmtDuration(secs) {
  if (!secs) return 'Unknown';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
