/**
 * ai.js — OpenAI API integration for narrative generation
 *
 * Takes a lightweight JSON flight report and asks the OpenAI API
 * to produce an ELI5-style narrative about the flight.
 */

const FlightAI = (() => {
  'use strict';

  const API_URL = 'https://api.openai.com/v1/chat/completions';
  const MODEL   = 'gpt-4o-mini';

  /**
   * Returns the stored API key or null.
   */
  function getApiKey() {
    return localStorage.getItem('openai_api_key');
  }

  /**
   * Stores the API key in localStorage.
   */
  function setApiKey(key) {
    localStorage.setItem('openai_api_key', key);
  }

  /**
   * Build a compact summary object from the parsed flight data.
   */
  function buildSummary(report) {
    const batteryDelta =
      report.batteryStart !== null && report.batteryEnd !== null
        ? report.batteryStart - report.batteryEnd
        : null;

    return {
      filename: report.filename,
      flightTimeSec: report.flightTimeMs !== null
        ? Math.round(report.flightTimeMs / 1000)
        : 'Data Inconclusive',
      maxAltitudeM: Math.round(report.maxAltitudeM * 10) / 10,
      maxGroundspeedMs: Math.round(report.maxGroundspeedMs * 10) / 10,
      batteryStart: report.batteryStart,
      batteryEnd: report.batteryEnd,
      batteryDelta,
      modesUsed: report.modes.map((m) => m.mode),
      criticalEvents: report.events
        .filter((e) => e.type === 'STATUS' || e.type === 'ARM' || e.type === 'DISARM')
        .map((e) => ({
          type: e.type,
          text: e.text,
          severity: e.severityLabel || null,
        })),
      modeChanges: report.events
        .filter((e) => e.type === 'MODE')
        .map((e) => e.text),
    };
  }

  /**
   * Generate an ELI20 structured narrative for a single flight.
   * Returns a parsed JSON object with sections, or a fallback string.
   */
  async function generateNarrative(report) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(
        'No OpenAI API key found. Click the 🔑 API Key button in the header to set your key.'
      );
    }

    const summary = buildSummary(report);

    const systemPrompt = `You are a friendly drone flight analyst writing for everyday people (age 20+) who are NOT engineers. Your goal is to explain what happened during a drone flight so clearly that anyone can understand it, using plain English and helpful analogies. Avoid hex codes or technical acronyms unless you immediately explain them.

You MUST respond with valid JSON only — no markdown fences, no extra text — matching this exact structure:
{
  "overview": "<2 sentences: Was the flight successful or did it fail? What was the key outcome?>",
  "theGood": "<1-3 bullet points of what went well, in plain English. Use • as bullet character.>",
  "theBad": "<If anomalies occurred: explain each problem in plain English with an analogy. E.g. 'The compass couldn't figure out which way was North — like trying to navigate without a map.' If no anomalies, write 'No significant issues detected.'>",
  "howToFix": "<Actionable steps for the pilot to address each problem found. If no problems, write 'No action required — great flight!'>",
  "problemFixPairs": [
    { "problem": "<short problem label>", "fix": "<concrete fix step>" }
  ]
}

STRICT RULES:
- If flightTimeSec is "Data Inconclusive" or timestamps appear unreliable (e.g. wildly large numbers), you MUST write "Data Inconclusive" for flight duration — do NOT invent a duration.
- Do NOT invent or assume any data not present in the JSON I provide.
- Keep each section concise (2-5 sentences or bullet points max).
- problemFixPairs must be an array; use [] if there are no problems.`;

    const userPrompt = `Flight data for "${summary.filename}":

${JSON.stringify(summary, null, 2)}

Generate the ELI20 flight report JSON.`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 900,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();

    // Parse structured JSON; fall back to raw text if parsing fails
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return { _raw: raw };
    }
  }

  /**
   * Generate a master summary narrative across multiple flights.
   */
  async function generateMasterNarrative(reports) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(
        'No OpenAI API key found. Click the 🔑 API Key button in the header to set your key.'
      );
    }

    const summaries = reports.map(buildSummary);

    const systemPrompt = `You are a friendly drone flight analyst writing for everyday people (age 20+). Summarise multiple drone flights in plain English. Do NOT invent statistics — only use the data provided. If any flightTimeSec value is "Data Inconclusive", say so and do NOT calculate a total flight time for that flight.`;

    const userPrompt = `Here are data summaries for ${summaries.length} flights:

${JSON.stringify(summaries, null, 2)}

Please write a short master summary (2-3 paragraphs) that covers:
1. Total number of flights and combined flight time (skip any with "Data Inconclusive" duration).
2. Overall trends (altitude ranges, speeds, battery usage patterns).
3. Any recurring warnings or issues across flights and recommended actions.`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  return { getApiKey, setApiKey, generateNarrative, generateMasterNarrative, buildSummary };
})();
