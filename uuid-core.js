"use strict";

// ═══════════════════════════════════════════════════════════════════════
//  UUID core — RFC 9562
//
//  Zero-dependency engine. Pure functions for parse/format/encode, plus
//  generators for v1, v2, v3, v4, v5, v6, v7, v8, nil, and max. Loaded
//  before app.js (and tests.html) so the consts below become script-scope
//  bindings visible to anything that runs after.
// ═══════════════════════════════════════════════════════════════════════

const bytesToHex = (b) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const hexToBytes = (h) => {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 32) throw new Error("hex must be 32 chars");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const bytesToBits = (b) =>
  Array.from(b, (x) => x.toString(2).padStart(8, "0")).join("");

const formatPretty = (b) => {
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const bytesToBase64 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
};

const bytesToBigInt = (b) => {
  let n = 0n;
  for (let i = 0; i < b.length; i++) n = (n << 8n) | BigInt(b[i]);
  return n;
};

// Crockford base32, 26 chars for 128 bits (ULID-style, MSB-first).
const bytesToBase32Crockford = (b) => {
  const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let n = bytesToBigInt(b);
  const out = new Array(26);
  for (let i = 25; i >= 0; i--) {
    out[i] = ALPH[Number(n & 0x1fn)];
    n >>= 5n;
  }
  return out.join("");
};

// ── MD5 (RFC 1321) ────────────────────────────────────────────────────
// Needed for v3. Web Crypto does not expose MD5, so we run a small
// implementation. Input + output are Uint8Array.
const _md5K = (() => {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++)
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  return K;
})();
const _md5S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];
const md5 = (input) => {
  const ml = input.length;
  const padLen = ((ml + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(input);
  padded[ml] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, (ml * 8) >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor((ml * 8) / 0x100000000) >>> 0, true);

  let A0 = 0x67452301,
    B0 = 0xefcdab89,
    C0 = 0x98badcfe,
    D0 = 0x10325476;
  for (let off = 0; off < padLen; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = A0,
      B = B0,
      C = C0,
      D = D0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + _md5K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const sh = _md5S[i];
      B = (B + ((F << sh) | (F >>> (32 - sh)))) >>> 0;
    }
    A0 = (A0 + A) >>> 0;
    B0 = (B0 + B) >>> 0;
    C0 = (C0 + C) >>> 0;
    D0 = (D0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, A0, true);
  odv.setUint32(4, B0, true);
  odv.setUint32(8, C0, true);
  odv.setUint32(12, D0, true);
  return out;
};

// Accepts 8-4-4-4-12, with or without dashes, with optional urn:uuid: prefix
// or { } braces. Case-insensitive.
const UUID_RE =
  /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i;

const parseUuid = (input) => {
  if (input == null) return null;
  let s = String(input).trim();
  if (s.startsWith("urn:uuid:")) s = s.slice(9);
  s = s.replace(/^\{|\}$/g, "").trim();
  const m = UUID_RE.exec(s);
  if (!m) return null;
  return hexToBytes((m[1] + m[2] + m[3] + m[4] + m[5]).toLowerCase());
};

const getVersion = (b) => (b[6] >> 4) & 0x0f;

const getVariant = (b) => {
  const v = b[8];
  if ((v & 0x80) === 0x00) return "NCS";
  if ((v & 0xc0) === 0x80) return "RFC"; // RFC 4122 / 9562
  if ((v & 0xe0) === 0xc0) return "Microsoft";
  return "Reserved";
};

const isNilBytes = (b) => {
  for (let i = 0; i < 16; i++) if (b[i] !== 0x00) return false;
  return true;
};
const isMaxBytes = (b) => {
  for (let i = 0; i < 16; i++) if (b[i] !== 0xff) return false;
  return true;
};

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// ── v4: fully random, ver=4 var=10 ────────────────────────────────────
const v4 = () => {
  const b = rand(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b;
};

// ── v7: 48b unix_ts_ms | 4b ver | 12b rand_a | 2b var | 62b rand_b ────
//   rand_a modes (RFC 9562 §6.2):
//     'random'   — 12 fresh random bits
//     'counter'  — Method 1: 24-bit fixed-length counter spanning rand_a
//                  (high 12) and rand_b's top 12. Leftmost bit cleared on
//                  init per RFC SHOULD; forces rand_b mode to 'random'
//                  (counter occupies rand_b's high bits).
//     'sub-ms'   — Method 3: top 8 bits of rand_a are a sub-ms tick;
//                  bottom 4 bits stay random.
//   rand_b modes:
//     'random'    — 62 fresh random bits
//     'monotonic' — Method 2: 74-bit monotonic payload spanning rand_a ‖
//                   rand_b. Overrides any rand_a mode.
//     'node'      — top 16 bits = fixed node id; remainder random.
let _v7LastMs = -1;
let _v7Counter = 0n; // 24-bit BigInt
let _v7MonoLastMs = -1;
let _v7MonoLastPayload = 0n;
const _V7_RANDB_MAX = (1n << 62n) - 1n;
const _V7_PAYLOAD_MAX = (1n << 74n) - 1n; // 12-bit rand_a ‖ 62-bit rand_b
const _V7_COUNTER_MAX = (1n << 24n) - 1n; // 24-bit Method-1 counter

const v7 = ({
  tsMs,
  randAMode = "random",
  randBMode = "random",
  nodeId = null,
} = {}) => {
  const ms = tsMs != null ? BigInt(tsMs) : BigInt(Date.now());
  const b = new Uint8Array(16);
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & 0xffn);
    t >>= 8n;
  }

  let randA = 0;
  let randB = 0n;

  if (randBMode === "monotonic") {
    // ── Method 2: rand_a ‖ rand_b as one 74-bit monotonic counter ─────
    const msNum = Number(ms);
    if (msNum === _v7MonoLastMs && _v7MonoLastPayload < _V7_PAYLOAD_MAX) {
      const ir = rand(4);
      // 30-bit delta, forced ≥ 1 so the byte-string strictly increases.
      let delta =
        ((BigInt(ir[0]) << 24n) |
          (BigInt(ir[1]) << 16n) |
          (BigInt(ir[2]) << 8n) |
          BigInt(ir[3])) &
        0x3fffffffn;
      delta = delta | 1n;
      let next = _v7MonoLastPayload + delta;
      if (next > _V7_PAYLOAD_MAX) {
        // overflow → reseed
        const rb = rand(10);
        let v = 0n;
        for (let i = 0; i < 10; i++) v = (v << 8n) | BigInt(rb[i]);
        next = v & _V7_PAYLOAD_MAX;
      }
      _v7MonoLastPayload = next;
    } else {
      _v7MonoLastMs = msNum;
      const rb = rand(10);
      let v = 0n;
      for (let i = 0; i < 10; i++) v = (v << 8n) | BigInt(rb[i]);
      _v7MonoLastPayload = v & _V7_PAYLOAD_MAX;
    }
    randA = Number(_v7MonoLastPayload >> 62n) & 0x0fff;
    randB = _v7MonoLastPayload & _V7_RANDB_MAX;
  } else if (randAMode === "counter") {
    // ── Method 1: 24-bit counter, hi 12 → rand_a, lo 12 → rand_b high ──
    const msNum = Number(ms);
    if (msNum === _v7LastMs) {
      _v7Counter = (_v7Counter + 1n) & _V7_COUNTER_MAX;
    } else {
      _v7LastMs = msNum;
      const r = rand(3);
      // Leftmost bit cleared (RFC §6.2 rollover protection): 23-bit seed.
      _v7Counter =
        ((BigInt(r[0]) << 16n) | (BigInt(r[1]) << 8n) | BigInt(r[2])) &
        0x7fffffn;
    }
    randA = Number(_v7Counter >> 12n) & 0x0fff;
    const counterLo = _v7Counter & 0xfffn;
    // rand_b: counter low 12 bits in the high, 50 random bits below.
    const rb = rand(7);
    let rest = 0n;
    for (let i = 0; i < 7; i++) rest = (rest << 8n) | BigInt(rb[i]);
    rest = rest & ((1n << 50n) - 1n);
    randB = (counterLo << 50n) | rest;
  } else {
    // ── rand_a (12 bits) ────────────────────────────────────────────────
    if (randAMode === "sub-ms") {
      // Method 3 narrowed: 8-bit sub-ms tick (~4 μs steps) + 4-bit random.
      const frac =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) %
        1;
      const sub = Math.floor(frac * 256) & 0xff;
      const pad = rand(1)[0] & 0x0f;
      randA = (sub << 4) | pad;
    } else {
      const r = rand(2);
      randA = ((r[0] << 8) | r[1]) & 0x0fff;
    }

    // ── rand_b (62 bits) ────────────────────────────────────────────────
    const rb = rand(8);
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(rb[i]);
    randB = v & _V7_RANDB_MAX;
    if (randBMode === "node" && nodeId != null) {
      // Top 16 bits of rand_b = node id; bottom 46 bits stay random.
      const lowMask = (1n << 46n) - 1n;
      randB = (BigInt(nodeId & 0xffff) << 46n) | (randB & lowMask);
    }
  }

  // Place rand_a in low 4 of byte 6 + byte 7
  b[6] = (randA >> 8) & 0x0f;
  b[7] = randA & 0xff;
  // Place rand_b in bytes 8..15; top 2 of byte 8 stay 0 (variant set below)
  let vb = randB;
  for (let i = 15; i >= 8; i--) {
    b[i] = Number(vb & 0xffn);
    vb >>= 8n;
  }

  b[6] = (b[6] & 0x0f) | 0x70; // version = 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant = 10
  return b;
};

// ── v8: only ver/var fixed — payload is implementation-defined ────────
const v8 = (opts = {}) => {
  let b;
  if (opts instanceof Uint8Array) {
    if (opts.length !== 16) throw new Error("v8 needs 16 bytes");
    b = new Uint8Array(opts);
  } else {
    b = rand(16);
    if (opts.tsMs != null) {
      let t = BigInt(opts.tsMs);
      for (let i = 5; i >= 0; i--) {
        b[i] = Number(t & 0xffn);
        t >>= 8n;
      }
    }
  }
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b;
};

const nilUuid = () => new Uint8Array(16);
const maxUuid = () => {
  const b = new Uint8Array(16);
  b.fill(0xff);
  return b;
};

// ── v1: time + clock_seq + node (Gregorian-epoch 100ns timestamp) ─────
const V1_EPOCH_OFFSET_MS = 12219292800000n;
const _gregorianTicks = (tsMs) => {
  const ms = BigInt(tsMs != null ? tsMs : Date.now());
  return (ms + V1_EPOCH_OFFSET_MS) * 10000n;
};
const _putNode = (b, nodeId) => {
  if (nodeId != null) {
    let n = BigInt(nodeId);
    for (let i = 15; i >= 10; i--) {
      b[i] = Number(n & 0xffn);
      n >>= 8n;
    }
  } else {
    const nb = rand(6);
    for (let i = 0; i < 6; i++) b[10 + i] = nb[i];
    b[10] |= 0x01; // multicast bit set — signals "not a real MAC"
  }
};
const v1 = ({ tsMs, clockSeq, nodeId } = {}) => {
  const t = _gregorianTicks(tsMs);
  const timeLow = Number(t & 0xffffffffn);
  const timeMid = Number((t >> 32n) & 0xffffn);
  const timeHi = Number((t >> 48n) & 0x0fffn);
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, timeLow >>> 0);
  dv.setUint16(4, timeMid);
  dv.setUint16(6, (1 << 12) | timeHi);
  const cr = rand(2);
  const cs =
    clockSeq != null ? clockSeq & 0x3fff : ((cr[0] << 8) | cr[1]) & 0x3fff;
  b[8] = 0x80 | ((cs >> 8) & 0x3f);
  b[9] = cs & 0xff;
  _putNode(b, nodeId);
  return b;
};

// ── v2: DCE Security — v1 layout with local_id replacing time_low ─────
const v2 = ({ tsMs, localId, domain = 0, clockSeq, nodeId } = {}) => {
  const t = _gregorianTicks(tsMs);
  const timeMid = Number((t >> 32n) & 0xffffn);
  const timeHi = Number((t >> 48n) & 0x0fffn);
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  let lid;
  if (localId != null) {
    lid = localId >>> 0;
  } else {
    const r = rand(4);
    lid = (r[0] | (r[1] << 8) | (r[2] << 16) | (r[3] << 24)) >>> 0;
  }
  dv.setUint32(0, lid);
  dv.setUint16(4, timeMid);
  dv.setUint16(6, (2 << 12) | timeHi);
  const cs = clockSeq != null ? clockSeq & 0x3f : rand(1)[0] & 0x3f;
  b[8] = 0x80 | cs;
  b[9] = domain & 0xff;
  _putNode(b, nodeId);
  return b;
};

// ── v6: v1 timestamp, reordered so the bytes sort by time ─────────────
const v6 = ({ tsMs, clockSeq, nodeId } = {}) => {
  const t = _gregorianTicks(tsMs);
  const thm = t >> 12n; // high 48 bits
  const tlo = Number(t & 0x0fffn); // low 12 bits
  const b = new Uint8Array(16);
  let h = thm;
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(h & 0xffn);
    h >>= 8n;
  }
  b[6] = 0x60 | ((tlo >> 8) & 0x0f);
  b[7] = tlo & 0xff;
  const cr = rand(2);
  const cs =
    clockSeq != null ? clockSeq & 0x3fff : ((cr[0] << 8) | cr[1]) & 0x3fff;
  b[8] = 0x80 | ((cs >> 8) & 0x3f);
  b[9] = cs & 0xff;
  _putNode(b, nodeId);
  return b;
};

// ── v3 / v5: hash(namespace || name); v3=MD5, v5=SHA-1 ────────────────
const NS_DNS = parseUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const _enc = new TextEncoder();
const _hashInput = (nsBytes, name) => {
  const nm = _enc.encode(name);
  const buf = new Uint8Array(16 + nm.length);
  buf.set(nsBytes);
  buf.set(nm, 16);
  return buf;
};
const v3 = (ns = NS_DNS, name = "") => {
  const b = md5(_hashInput(ns, name));
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b;
};
const v5 = async (ns = NS_DNS, name = "") => {
  const hashBuf = await crypto.subtle.digest("SHA-1", _hashInput(ns, name));
  const b = new Uint8Array(hashBuf).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b;
};
// Per-tab random tag so two probe windows generating v3/v5 don't collide.
const _hashTag = (() => {
  const r = rand(4);
  return Array.from(r, (x) => x.toString(16).padStart(2, "0")).join("");
})();
let _hashSeq = 0;
const _nextHashName = () => `name-${_hashTag}-${++_hashSeq}`;

// ── v7 decoders ───────────────────────────────────────────────────────
const v7Timestamp = (b) => {
  let n = 0n;
  for (let i = 0; i < 6; i++) n = (n << 8n) | BigInt(b[i]);
  return Number(n);
};
const v7RandA = (b) => ((b[6] & 0x0f) << 8) | b[7];
const v7RandBHex = (b) => {
  let s = (b[8] & 0x3f).toString(16).padStart(2, "0");
  for (let i = 9; i < 16; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
};
const v7RandBBig = (b) => {
  let n = 0n;
  for (let i = 8; i < 16; i++) n = (n << 8n) | BigInt(b[i]);
  return n & ((1n << 62n) - 1n); // strip variant bits 64-65
};
const v7NodeId = (b) => Number(v7RandBBig(b) >> 46n) & 0xffff;
// 24-bit counter (Method 1): hi 12 = rand_a, lo 12 = top of rand_b.
const v7Counter24 = (b) =>
  (v7RandA(b) << 12) | (Number(v7RandBBig(b) >> 50n) & 0x0fff);
// 8-bit sub-ms tick + 4-bit random padding inside rand_a.
const v7SubMs = (b) => (v7RandA(b) >> 4) & 0xff;
const v7SubRand = (b) => v7RandA(b) & 0x0f;

const validate = (b) => {
  if (isNilBytes(b)) return { valid: true, kind: "nil", issues: [] };
  if (isMaxBytes(b)) return { valid: true, kind: "max", issues: [] };
  const ver = getVersion(b);
  const variant = getVariant(b);
  const issues = [];
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(ver))
    issues.push(`unknown version: ${ver}`);
  if (variant !== "RFC") issues.push(`non-RFC variant: ${variant}`);
  return { valid: issues.length === 0, kind: "v" + ver, issues };
};
