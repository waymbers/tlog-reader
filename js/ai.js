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
      flightTimeSec: Math.round((report.flightTimeMs || 0) / 1000),
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
   * Generate an ELI5 narrative for a single flight.
   * Returns the AI-generated text string.
   */
  async function generateNarrative(report) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(
        'No OpenAI API key found. Click the 🔑 API Key button in the header to set your key.'
      );
    }

    const summary = buildSummary(report);

    const systemPrompt = `You are a friendly drone flight analyst. You explain MAVLink telemetry data in simple, everyday language that a non-technical person can understand. Your tone is warm, clear, and reassuring. When something went wrong during a flight, explain what happened and why, not just the error code. Use analogies when helpful. Keep your response concise (2-4 paragraphs).`;

    const userPrompt = `Here is the flight data summary for "${summary.filename}":

${JSON.stringify(summary, null, 2)}

Please write a short, easy-to-understand report about this flight. Include:
1. A one-sentence overview of how the flight went.
2. Key stats in plain English (altitude, speed, battery usage, flight time).
3. If there were any warnings, errors, or failsafes, explain what they mean and what the pilot should do.
4. If mode changes occurred, explain what each mode does in simple terms.`;

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
        max_tokens: 800,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
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

    const systemPrompt = `You are a friendly drone flight analyst. You provide clear, non-technical summaries of multiple drone flights. Your audience is hobbyists and operations managers who are not engineers.`;

    const userPrompt = `Here are data summaries for ${summaries.length} flights:

${JSON.stringify(summaries, null, 2)}

Please write a short master summary (2-3 paragraphs) that covers:
1. Total number of flights and combined flight time.
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
        temperature: 0.7,
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
