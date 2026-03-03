/**
 * parser.js — MAVLink .tlog binary parser
 *
 * A .tlog file is a continuous stream of MAVLink packets, each prepended with
 * an 8-byte microsecond timestamp (uint64 LE).
 *
 * MAVLink v1 packet layout (after timestamp):
 *   0xFE | payload_len | seq | sysid | compid | msgid | payload... | ckA | ckB
 *
 * MAVLink v2 packet layout (after timestamp):
 *   0xFD | payload_len | incompat_flags | compat_flags | seq | sysid | compid
 *   | msgid(3 bytes LE) | payload... | ckA | ckB | (optional signature 13 bytes)
 */

/* global */ // eslint-disable-line
const TLogParser = (() => {
  'use strict';

  // ArduPilot Copter flight mode map
  const COPTER_MODES = {
    0: 'Stabilize',
    1: 'Acro',
    2: 'AltHold',
    3: 'Auto',
    4: 'Guided',
    5: 'Loiter',
    6: 'RTL',
    7: 'Circle',
    9: 'Land',
    11: 'Drift',
    13: 'Sport',
    14: 'Flip',
    15: 'AutoTune',
    16: 'PosHold',
    17: 'Brake',
    18: 'Throw',
    19: 'Avoid_ADSB',
    20: 'Guided_NoGPS',
    21: 'Smart_RTL',
    22: 'FlowHold',
    23: 'Follow',
    24: 'ZigZag',
    25: 'SystemID',
    26: 'Heli_Autorotate',
    27: 'Auto RTL',
  };

  const SEVERITY_LABELS = [
    'Emergency', 'Alert', 'Critical', 'Error', 'Warning',
    'Notice', 'Info', 'Debug',
  ];

  /**
   * Parse a single .tlog ArrayBuffer.
   * Returns a lightweight JSON report object.
   */
  function parse(buffer, filename) {
    const view = new DataView(buffer);
    const len = buffer.byteLength;

    const result = {
      filename: filename || 'unknown.tlog',
      totalBytes: len,
      packets: 0,
      flightTimeMs: null,        // null = inconclusive until arm/disarm found
      firstTimestamp: null,
      lastTimestamp: null,
      maxAltitudeM: 0,
      maxGroundspeedMs: 0,
      batteryStart: null,
      batteryEnd: null,
      modes: [],
      events: [],
      rawEvents: [],             // all STATUSTEXT + MODE + ARM/DISARM for the raw stream
      altHistory: [],            // { time, alt } sampled for chart
      armed: false,
      armedTime: null,
      disarmedTime: null,
    };

    let offset = 0;

    while (offset < len - 8) {
      // Read 8-byte timestamp (microseconds since epoch, uint64 LE)
      let timestampUs;
      try {
        timestampUs = readUint64LE(view, offset);
      } catch (_e) {
        break;
      }

      offset += 8;
      if (offset >= len) break;

      const sync = view.getUint8(offset);

      if (sync === 0xFE) {
        // MAVLink v1
        offset = parseV1Packet(view, offset, len, timestampUs, result);
      } else if (sync === 0xFD) {
        // MAVLink v2
        offset = parseV2Packet(view, offset, len, timestampUs, result);
      } else {
        // Not a valid sync byte — advance one byte and try again
        offset++;
      }
    }

    // Compute derived metrics
    // Prefer arm→disarm window for flight time (ignores bench/idle time)
    if (result.armedTime !== null && result.disarmedTime !== null) {
      result.flightTimeMs = result.disarmedTime - result.armedTime;
    } else if (result.armedTime !== null && result.lastTimestamp !== null) {
      // Still armed at end of log
      result.flightTimeMs = result.lastTimestamp - result.armedTime;
    } else {
      // No arm event: mark as inconclusive
      result.flightTimeMs = null;
    }

    return result;
  }

  /**
   * Parse a MAVLink v1 packet starting at `offset`.
   * Returns the new offset after the packet.
   */
  function parseV1Packet(view, offset, len, timestampUs, result) {
    // Header: STX(1) + payload_len(1) + seq(1) + sysid(1) + compid(1) + msgid(1)
    if (offset + 6 > len) return len;

    const payloadLen = view.getUint8(offset + 1);
    const totalPacketLen = 6 + payloadLen + 2; // header + payload + checksum

    if (offset + totalPacketLen > len) return len;

    const msgId = view.getUint8(offset + 5);
    const payloadStart = offset + 6;
    const tsMs = timestampUs / 1000;

    updateTimestamps(result, tsMs);
    result.packets++;

    decodePayload(view, payloadStart, payloadLen, msgId, tsMs, result);

    return offset + totalPacketLen;
  }

  /**
   * Parse a MAVLink v2 packet starting at `offset`.
   * Returns the new offset after the packet.
   */
  function parseV2Packet(view, offset, len, timestampUs, result) {
    // Header: STX(1) + payload_len(1) + incompat(1) + compat(1) + seq(1)
    //         + sysid(1) + compid(1) + msgid(3)
    if (offset + 10 > len) return len;

    const payloadLen = view.getUint8(offset + 1);
    const incompatFlags = view.getUint8(offset + 2);
    const hasSig = (incompatFlags & 0x01) !== 0;
    const totalPacketLen = 10 + payloadLen + 2 + (hasSig ? 13 : 0);

    if (offset + totalPacketLen > len) return len;

    // 3-byte msgid (little-endian)
    const msgId =
      view.getUint8(offset + 7) |
      (view.getUint8(offset + 8) << 8) |
      (view.getUint8(offset + 9) << 16);
    const payloadStart = offset + 10;
    const tsMs = timestampUs / 1000;

    updateTimestamps(result, tsMs);
    result.packets++;

    decodePayload(view, payloadStart, payloadLen, msgId, tsMs, result);

    return offset + totalPacketLen;
  }

  /**
   * Decode known payload types.
   */
  function decodePayload(view, start, payloadLen, msgId, tsMs, result) {
    switch (msgId) {
      case 0:
        decodeHeartbeat(view, start, payloadLen, tsMs, result);
        break;
      case 1:
        decodeSysStatus(view, start, payloadLen, tsMs, result);
        break;
      case 33:
        decodeGlobalPositionInt(view, start, payloadLen, tsMs, result);
        break;
      case 74:
        decodeVfrHud(view, start, payloadLen, tsMs, result);
        break;
      case 253:
        decodeStatusText(view, start, payloadLen, tsMs, result);
        break;
    }
  }

  /* ── MsgID 0: HEARTBEAT ── */
  function decodeHeartbeat(view, start, payloadLen, tsMs, result) {
    if (payloadLen < 7) return;

    const customMode = view.getUint32(start, true); // bytes 0-3
    const baseMode = view.getUint8(start + 6);      // byte 6
    const isArmed = (baseMode & 0x80) !== 0;

    const modeName = COPTER_MODES[customMode] || `Mode ${customMode}`;

    // Track arm / disarm transitions
    if (isArmed && !result.armed) {
      result.armed = true;
      result.armedTime = tsMs;
      const e = { time: tsMs, type: 'ARM', text: 'Vehicle ARMED' };
      result.events.push(e);
      result.rawEvents.push(e);
    } else if (!isArmed && result.armed) {
      result.armed = false;
      result.disarmedTime = tsMs;
      const e = { time: tsMs, type: 'DISARM', text: 'Vehicle DISARMED' };
      result.events.push(e);
      result.rawEvents.push(e);
    }

    // Track mode changes
    const lastMode = result.modes.length > 0 ? result.modes[result.modes.length - 1] : null;
    if (!lastMode || lastMode.mode !== modeName) {
      result.modes.push({ time: tsMs, mode: modeName });
      const e = { time: tsMs, type: 'MODE', text: `Mode → ${modeName}` };
      result.events.push(e);
      result.rawEvents.push(e);
    }
  }

  /* ── MsgID 1: SYS_STATUS ── */
  function decodeSysStatus(view, start, payloadLen, tsMs, result) {
    if (payloadLen < 31) return;
    const remaining = view.getInt8(start + 30); // byte 30
    if (remaining < 0) return; // invalid

    if (result.batteryStart === null) {
      result.batteryStart = remaining;
    }
    result.batteryEnd = remaining;
  }

  /* ── MsgID 33: GLOBAL_POSITION_INT ── */
  function decodeGlobalPositionInt(view, start, payloadLen, tsMs, result) {
    if (payloadLen < 20) return;
    const relAltMm = view.getInt32(start + 16, true); // bytes 16-19
    const altM = relAltMm / 1000;
    if (altM > result.maxAltitudeM) {
      result.maxAltitudeM = altM;
    }
    // Sample altitude history for chart (at most once per second to limit size)
    if (result.altHistory.length === 0 ||
        tsMs - result.altHistory[result.altHistory.length - 1].time >= 1000) {
      result.altHistory.push({ time: tsMs, alt: Math.max(0, altM) });
    }
  }

  /* ── MsgID 74: VFR_HUD ── */
  function decodeVfrHud(view, start, payloadLen, _tsMs, result) {
    if (payloadLen < 8) return;
    const groundspeed = view.getFloat32(start + 4, true); // bytes 4-7
    if (groundspeed > result.maxGroundspeedMs) {
      result.maxGroundspeedMs = groundspeed;
    }
  }

  /* ── MsgID 253: STATUSTEXT ── */
  function decodeStatusText(view, start, payloadLen, tsMs, result) {
    if (payloadLen < 2) return;
    const severity = view.getUint8(start); // byte 0

    // Read null-terminated string from bytes 1..50
    const maxTextLen = Math.min(50, payloadLen - 1);
    let text = '';
    for (let i = 0; i < maxTextLen; i++) {
      const ch = view.getUint8(start + 1 + i);
      if (ch === 0) break;
      text += String.fromCharCode(ch);
    }

    const sevLabel = SEVERITY_LABELS[severity] || `Severity ${severity}`;
    const e = {
      time: tsMs,
      type: 'STATUS',
      severity,
      severityLabel: sevLabel,
      text: text.trim(),
    };

    // Raw stream gets every status message
    result.rawEvents.push(e);

    // Main events list: only Warning (4) or worse for the summary
    if (severity <= 4) {
      result.events.push(e);
    }
  }

  /* ── Helpers ── */
  function updateTimestamps(result, tsMs) {
    if (result.firstTimestamp === null || tsMs < result.firstTimestamp) {
      result.firstTimestamp = tsMs;
    }
    if (result.lastTimestamp === null || tsMs > result.lastTimestamp) {
      result.lastTimestamp = tsMs;
    }
  }

  /**
   * Read a 64-bit unsigned integer (LE) as a JS number.
   * Precision is limited to Number.MAX_SAFE_INTEGER but that's fine for timestamps.
   */
  function readUint64LE(view, offset) {
    const lo = view.getUint32(offset, true);
    const hi = view.getUint32(offset + 4, true);
    return hi * 0x100000000 + lo;
  }

  return { parse, COPTER_MODES, SEVERITY_LABELS };
})();
