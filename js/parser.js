/**
 * MAVLink .tlog binary parser.
 * Scans an ArrayBuffer for MAVLink v1 (0xFE) and v2 (0xFD) sync bytes
 * and extracts key flight metrics without any external dependencies.
 *
 * Reference: https://mavlink.io/en/messages/common.html
 *            https://ardupilot.org/copter/docs/flight-modes.html
 */

const COPTER_MODES = {
  0: 'Stabilize', 1: 'Acro', 2: 'AltHold', 3: 'Auto',
  4: 'Guided', 5: 'Loiter', 6: 'RTL', 7: 'Circle',
  9: 'Land', 11: 'Drift', 13: 'Sport', 14: 'Flip',
  15: 'AutoTune', 16: 'PosHold', 17: 'Brake', 18: 'Throw',
  19: 'Avoid_ADSB', 20: 'Guided_NoGPS', 21: 'SmartRTL',
};

const SEVERITY = {
  0: 'EMERGENCY', 1: 'ALERT', 2: 'CRITICAL',
  3: 'ERROR', 4: 'WARNING', 5: 'NOTICE', 6: 'INFO', 7: 'DEBUG',
};

/**
 * @param {ArrayBuffer} buffer
 * @returns {Object} extracted flight metrics
 */
export function parseTlog(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;

  const fd = {
    maxAltitude: -Infinity,
    minAltitude: Infinity,
    altitudeReadings: [],
    maxSpeed: 0,
    speedReadings: [],
    batteryStart: null,
    batteryEnd: null,
    batteryReadings: [],
    modeChanges: [],
    statusMessages: [],
    armedEvents: [],
    startTimestamp: null,
    endTimestamp: null,
    packetCount: 0,
  };

  // Mutable parse state tracked across packets
  const state = { lastMode: null, lastArmed: null };

  let i = 0;
  while (i < len) {
    const sync = bytes[i];

    if (sync === 0xFE) {
      // ── MAVLink v1 ──────────────────────────────────────────────
      // Header: [sync, payloadLen, seq, sysid, compid, msgid] = 6 bytes
      // Tail:   [cksum_lo, cksum_hi] = 2 bytes
      if (i + 8 > len) { i++; continue; }
      const payloadLen = bytes[i + 1];
      const msgId = bytes[i + 5];
      const payloadStart = i + 6;
      if (payloadStart + payloadLen + 2 > len) { i++; continue; }

      const ts = extractTimestamp(view, i);
      updateTimestamps(fd, ts);
      processMsg(view, bytes, msgId, payloadStart, payloadLen, ts, fd, state);

      fd.packetCount++;
      i = payloadStart + payloadLen + 2;

    } else if (sync === 0xFD) {
      // ── MAVLink v2 ──────────────────────────────────────────────
      // Header: [sync, payloadLen, incompat, compat, seq, sysid, compid, msgid(3)] = 10 bytes
      // Tail:   [cksum_lo, cksum_hi] = 2 bytes  (+13 bytes optional signature)
      if (i + 12 > len) { i++; continue; }
      const payloadLen = bytes[i + 1];
      const incompatFlags = bytes[i + 2];
      const msgId = bytes[i + 7] | (bytes[i + 8] << 8) | (bytes[i + 9] << 16);
      const payloadStart = i + 10;
      if (payloadStart + payloadLen + 2 > len) { i++; continue; }

      const ts = extractTimestamp(view, i);
      updateTimestamps(fd, ts);
      processMsg(view, bytes, msgId, payloadStart, payloadLen, ts, fd, state);

      fd.packetCount++;
      let next = payloadStart + payloadLen + 2;
      if (incompatFlags & 0x01) next += 13; // MAVLINK_IFLAG_SIGNED
      i = next;

    } else {
      i++;
    }
  }

  // ── Derived metrics ────────────────────────────────────────────
  if (!isFinite(fd.maxAltitude)) fd.maxAltitude = 0;
  if (!isFinite(fd.minAltitude)) fd.minAltitude = 0;

  fd.durationSeconds = (fd.startTimestamp && fd.endTimestamp)
    ? Math.max(0, Math.round((fd.endTimestamp - fd.startTimestamp) / 1000))
    : 0;

  fd.avgAltitude = fd.altitudeReadings.length
    ? fd.altitudeReadings.reduce((a, b) => a + b, 0) / fd.altitudeReadings.length
    : 0;

  fd.avgSpeed = fd.speedReadings.length
    ? fd.speedReadings.reduce((a, b) => a + b, 0) / fd.speedReadings.length
    : 0;

  return fd;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * .tlog files prepend an 8-byte big-endian uint64 Unix timestamp
 * (microseconds since epoch) before every MAVLink packet.
 * Returns milliseconds, or null if implausible.
 */
function extractTimestamp(view, syncIdx) {
  if (syncIdx < 8) return null;
  const hi = view.getUint32(syncIdx - 8, false);
  const lo = view.getUint32(syncIdx - 4, false);
  // Approximate (hi * 2^32 + lo) / 1000  →  ms
  const ms = hi * 4294967.296 + lo / 1000;
  // Sanity: must be between 2010-01-01 and 2040-01-01
  return (ms > 1262304000000 && ms < 2208988800000) ? ms : null;
}

function updateTimestamps(fd, ts) {
  if (ts === null) return;
  if (fd.startTimestamp === null) fd.startTimestamp = ts;
  fd.endTimestamp = ts;
}

function processMsg(view, bytes, msgId, ps, pl, ts, fd, state) {
  try {
    switch (msgId) {
      case 0: {
        // HEARTBEAT — custom_mode: uint32 @ 0, base_mode: uint8 @ 6
        if (pl < 7) return;
        const customMode = view.getUint32(ps, true);
        const baseMode = bytes[ps + 6];
        const armed = (baseMode & 0x80) !== 0;
        const mode = COPTER_MODES[customMode] ?? `Mode_${customMode}`;

        if (mode !== state.lastMode) {
          fd.modeChanges.push({ time: ts, mode, armed });
          state.lastMode = mode;
        }
        if (armed !== state.lastArmed) {
          fd.armedEvents.push({ time: ts, armed, mode });
          state.lastArmed = armed;
        }
        break;
      }
      case 1: {
        // SYS_STATUS — battery_remaining: int8 @ 30
        if (pl < 31) return;
        const pct = view.getInt8(ps + 30);
        if (pct >= 0 && pct <= 100) {
          if (fd.batteryStart === null) fd.batteryStart = pct;
          fd.batteryEnd = pct;
          fd.batteryReadings.push(pct);
        }
        break;
      }
      case 33: {
        // GLOBAL_POSITION_INT — relative_alt: int32 @ 16 (mm)
        if (pl < 20) return;
        const mm = view.getInt32(ps + 16, true);
        const m = mm / 1000;
        fd.altitudeReadings.push(m);
        if (m > fd.maxAltitude) fd.maxAltitude = m;
        if (m < fd.minAltitude) fd.minAltitude = m;
        break;
      }
      case 74: {
        // VFR_HUD — groundspeed: float32 @ 4 (m/s)
        if (pl < 8) return;
        const spd = view.getFloat32(ps + 4, true);
        if (spd >= 0 && spd < 200) {
          fd.speedReadings.push(spd);
          if (spd > fd.maxSpeed) fd.maxSpeed = spd;
        }
        break;
      }
      case 253: {
        // STATUSTEXT — severity: uint8 @ 0, text: char[50] @ 1
        if (pl < 2) return;
        const sev = bytes[ps];
        if (sev > 4) return; // Only WARNING (4) or worse
        const chars = [];
        const end = Math.min(pl - 1, 50);
        for (let j = 1; j <= end; j++) {
          const b = bytes[ps + j];
          if (b === 0) break;
          chars.push(b);
        }
        const text = String.fromCharCode(...chars).trim();
        if (text) {
          fd.statusMessages.push({
            time: ts,
            severity: sev,
            severityLabel: SEVERITY[sev] ?? `SEV_${sev}`,
            text,
          });
        }
        break;
      }
    }
  } catch (_) {
    // Skip malformed packets silently
  }
}
