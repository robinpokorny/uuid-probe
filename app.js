"use strict";

// ═══════════════════════════════════════════════════════════════════════
//  UUID Probe — RFC 9562 inspect surface, single-file vanilla JS.
//
//  Architecture: pure-functional render. State lives in one object;
//  every UI element is a pure function of that object. `update(patch)`
//  mutates state and schedules a single render on the next animation
//  frame, so even rapid hover-driven updates coalesce.
// ═══════════════════════════════════════════════════════════════════════

// ─── Field tint palette ────────────────────────────────────────────────
// Tints are declared by name on each field entry (see FIELDS below and
// the developer spec in FIELD_FORMAT.md). Adding a new tint is a single
// change here plus a matching CSS variable in studio.css.
const TINT_CSS = {
  timestamp: "var(--field-ts)",
  version: "var(--field-ver)",
  variant: "var(--field-var)",
  "rand-a": "var(--field-randA)",
  "rand-b": "var(--field-randB)",
  node: "var(--field-node)",
};
const _warnedTints = new Set();
const tintColor = (tint) => {
  if (tint && !(tint in TINT_CSS) && !_warnedTints.has(tint)) {
    _warnedTints.add(tint);
    console.warn(
      `[uuid-probe] unknown tint "${tint}" — falling back to rand-b. ` +
        `Add it to TINT_CSS (app.js) and studio.css.`,
    );
  }
  return TINT_CSS[tint] || TINT_CSS["rand-b"];
};

// Engine (parse/format/generate/validate) lives in uuid-core.js, which is
// loaded by index.html before this file. The functions, classes, constants,
// and v7 state declared there are visible to this script via the shared
// script-scope of non-module <script> tags.

// ── Field layouts ─────────────────────────────────────────────────────
// Each layout is an array of FieldEntry records. The entry is the single
// source of truth — its `type` tells the renderer how to decode the bits,
// `tint` picks the palette, `description` is the linear-walk prose, and
// `specSection` is the deep-link into the RFC. See FIELD_FORMAT.md for
// the developer spec — the same shape can be uploaded as a custom layout.
//
// Hash-bearing layouts (v3, v5) are built with this factory so the prose
// and algorithm flow from the same place.
const hashFields = (ver, sec, algo) => {
  const A = algo === "md5" ? "MD5" : "SHA-1";
  return [
    {
      start: 0,
      end: 47,
      key: "hashA",
      label: algo,
      type: "hash",
      tint: "rand-b",
      specSection: sec,
      description: `${A}(namespace ‖ name) — bits 0–47 of the hash. Deterministic, not random.`,
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: `ver = ${ver}`,
      type: "version",
      value: ver,
      tint: "version",
      specSection: "4.2",
      description: `Fixed: version ${ver} nibble, overwriting hash bits 48–51.`,
    },
    {
      start: 52,
      end: 63,
      key: "hashB",
      label: algo,
      type: "hash",
      tint: "rand-b",
      specSection: sec,
      description: `${A}(namespace ‖ name) — bits 52–63 of the hash (skipping the version nibble at 48–51).`,
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant, overwriting hash bits 64–65.",
    },
    {
      start: 66,
      end: 127,
      key: "hashC",
      label: algo,
      type: "hash",
      tint: "rand-b",
      specSection: sec,
      description: `${A}(namespace ‖ name) — bits 66–127 of the hash (skipping the variant bits).`,
    },
  ];
};

const FIELDS = {
  v1: [
    {
      start: 0,
      end: 31,
      key: "time_low",
      label: "time_low",
      type: "gregorian-ticks",
      group: "v1ts",
      groupOrder: 2,
      tint: "timestamp",
      specSection: "5.1",
      description: "Low 32 bits of the v1 100-ns Gregorian timestamp.",
    },
    {
      start: 32,
      end: 47,
      key: "time_mid",
      label: "time_mid",
      type: "gregorian-ticks",
      group: "v1ts",
      groupOrder: 1,
      tint: "timestamp",
      specSection: "5.1",
      description: "Mid 16 bits of the v1 100-ns Gregorian timestamp.",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "ver = 1",
      type: "version",
      value: 1,
      tint: "version",
      specSection: "4.2",
      description:
        "Fixed: marks this as version 1. Decoders MUST reject any other value.",
    },
    {
      start: 52,
      end: 63,
      key: "time_hi",
      label: "time_hi",
      type: "gregorian-ticks",
      group: "v1ts",
      groupOrder: 0,
      tint: "timestamp",
      specSection: "5.1",
      description: "High 12 bits of the v1 100-ns Gregorian timestamp.",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10.",
    },
    {
      start: 66,
      end: 71,
      key: "clock_hi",
      label: "clock_hi",
      type: "opaque",
      tint: "rand-a",
      specSection: "5.1",
      description:
        "High 6 bits of the clock sequence — guards against clock rewinds.",
    },
    {
      start: 72,
      end: 79,
      key: "clock_lo",
      label: "clock_lo",
      type: "opaque",
      tint: "rand-a",
      specSection: "5.1",
      description: "Low 8 bits of the clock sequence.",
    },
    {
      start: 80,
      end: 127,
      key: "node",
      label: "node (MAC)",
      type: "node-id",
      tint: "node",
      specSection: "5.1",
      description:
        "Node identifier — historically a 48-bit MAC address. RFC recommends a random value with the multicast bit set.",
    },
  ],
  v2: [
    {
      start: 0,
      end: 31,
      key: "local_id",
      label: "local_id",
      type: "integer-hex",
      tint: "timestamp",
      specSection: "5.2",
      description:
        "v2 local identifier — a POSIX UID or GID. v2 replaces time_low with this.",
    },
    {
      start: 32,
      end: 47,
      key: "time_mid",
      label: "time_mid",
      type: "opaque",
      tint: "timestamp",
      specSection: "5.2",
      description: "Mid 16 bits of the Gregorian timestamp.",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "ver = 2",
      type: "version",
      value: 2,
      tint: "version",
      specSection: "4.2",
      description: "Fixed: marks this as version 2 (DCE Security).",
    },
    {
      start: 52,
      end: 63,
      key: "time_hi",
      label: "time_hi",
      type: "opaque",
      tint: "timestamp",
      specSection: "5.2",
      description: "High 12 bits of the Gregorian timestamp.",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10.",
    },
    {
      start: 66,
      end: 71,
      key: "clock_hi",
      label: "clock_hi",
      type: "opaque",
      tint: "rand-a",
      specSection: "5.2",
      description: "Six-bit clock sequence.",
    },
    {
      start: 72,
      end: 79,
      key: "domain",
      label: "domain",
      type: "enum",
      values: { 0: "person (UID)", 1: "group (GID)", 2: "org" },
      tint: "rand-a",
      specSection: "5.2",
      description: "v2 local domain — POSIX UID/GID/organization context.",
    },
    {
      start: 80,
      end: 127,
      key: "node",
      label: "node",
      type: "node-id",
      tint: "node",
      specSection: "5.2",
      description: "Node identifier.",
    },
  ],
  v3: hashFields(3, "5.3", "md5"),
  v4: [
    {
      start: 0,
      end: 47,
      key: "r1",
      label: "random",
      type: "random",
      tint: "rand-b",
      specSection: "5.4",
      description: "Random bits.",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "ver = 4",
      type: "version",
      value: 4,
      tint: "version",
      specSection: "4.2",
      description: "Fixed: marks this as version 4 (random).",
    },
    {
      start: 52,
      end: 63,
      key: "r2",
      label: "random",
      type: "random",
      tint: "rand-a",
      specSection: "5.4",
      description: "Random bits.",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10.",
    },
    {
      start: 66,
      end: 127,
      key: "r3",
      label: "random",
      type: "random",
      tint: "rand-b",
      specSection: "5.4",
      description: "Random bits.",
    },
  ],
  v5: hashFields(5, "5.5", "sha1"),
  v6: [
    {
      start: 0,
      end: 47,
      key: "time_hi_mid",
      label: "time_hi_mid",
      type: "gregorian-ticks",
      group: "v6ts",
      groupOrder: 0,
      tint: "timestamp",
      specSection: "5.6",
      description:
        "High 48 bits of the v6 100-ns Gregorian timestamp (sortable byte-string).",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "ver = 6",
      type: "version",
      value: 6,
      tint: "version",
      specSection: "4.2",
      description: "Fixed: marks this as version 6 (reordered Gregorian).",
    },
    {
      start: 52,
      end: 63,
      key: "time_lo",
      label: "time_lo",
      type: "gregorian-ticks",
      group: "v6ts",
      groupOrder: 1,
      tint: "timestamp",
      specSection: "5.6",
      description: "Low 12 bits of the v6 100-ns Gregorian timestamp.",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10.",
    },
    {
      start: 66,
      end: 79,
      key: "clock_seq",
      label: "clock_seq",
      type: "integer-hex",
      tint: "rand-a",
      specSection: "5.6",
      description: "Clock sequence — guards against clock rewinds.",
    },
    {
      start: 80,
      end: 127,
      key: "node",
      label: "node",
      type: "node-id",
      tint: "node",
      specSection: "5.6",
      description: "Node identifier.",
    },
  ],
  v7: [
    {
      start: 0,
      end: 47,
      key: "ts",
      label: "unix_ts_ms",
      type: "timestamp-unix-ms",
      tint: "timestamp",
      specSection: "5.7",
      description:
        "Unix milliseconds since epoch — gives v7 its time-ordering. 48 bits ≈ until year 10889.",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "ver = 7",
      type: "version",
      value: 7,
      tint: "version",
      specSection: "4.2",
      description: "Fixed: marks this as version 7 (Unix-epoch time-ordered).",
    },
    {
      start: 52,
      end: 63,
      key: "randA",
      label: "rand_a",
      type: "random",
      tint: "rand-a",
      specSection: "5.7",
      description:
        "rand_a (12b): random by default. Knobs can repurpose it as a counter or sub-ms tick.",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10.",
    },
    {
      start: 66,
      end: 127,
      key: "randB",
      label: "rand_b",
      type: "random",
      tint: "rand-b",
      specSection: "5.7",
      description:
        "rand_b (62b): random bits. Knobs can embed a node id or extend monotonic ordering across this region.",
    },
  ],
  v8: [
    {
      start: 0,
      end: 47,
      key: "custA",
      label: "custom_a",
      type: "opaque",
      tint: "timestamp",
      specSection: "5.8",
      description:
        "custom_a — implementation defined. Use any 48 bits of data your application needs.",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "ver = 8",
      type: "version",
      value: 8,
      tint: "version",
      specSection: "4.2",
      description: "Fixed: marks this as version 8 (vendor/experimental).",
    },
    {
      start: 52,
      end: 63,
      key: "custB",
      label: "custom_b",
      type: "opaque",
      tint: "rand-a",
      specSection: "5.8",
      description: "custom_b — implementation defined (12 bits).",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "var = 10",
      type: "variant",
      value: "rfc",
      tint: "variant",
      specSection: "4.1",
      description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10.",
    },
    {
      start: 66,
      end: 127,
      key: "custC",
      label: "custom_c",
      type: "opaque",
      tint: "rand-b",
      specSection: "5.8",
      description: "custom_c — implementation defined (62 bits).",
    },
  ],
  nil: [
    {
      start: 0,
      end: 127,
      key: "nil",
      label: "all zeros",
      type: "static",
      value: "0".repeat(32),
      tint: "rand-b",
      specSection: "5.9",
      description:
        "The nil UUID — all 128 bits zero. Reserved as a sentinel for 'no UUID'.",
    },
  ],
  max: [
    {
      start: 0,
      end: 127,
      key: "max",
      label: "all ones",
      type: "static",
      value: "f".repeat(32),
      tint: "rand-b",
      specSection: "5.10",
      description:
        "The max UUID — all 128 bits one. Reserved as a sentinel for 'all UUIDs'.",
    },
  ],
  unknown: [
    {
      start: 0,
      end: 47,
      key: "pre",
      label: "bytes 0–5",
      type: "opaque",
      tint: "timestamp",
      description: "Bytes before the version nibble (unknown layout).",
    },
    {
      start: 48,
      end: 51,
      key: "ver",
      label: "version",
      type: "version",
      tint: "version",
      specSection: "4.2",
      description: "Version nibble — value unrecognized.",
    },
    {
      start: 52,
      end: 63,
      key: "mid",
      label: "bytes 6–7",
      type: "opaque",
      tint: "rand-a",
      description: "Bytes between version and variant.",
    },
    {
      start: 64,
      end: 65,
      key: "var",
      label: "variant",
      type: "variant",
      tint: "variant",
      specSection: "4.1",
      description: "Variant bits.",
    },
    {
      start: 66,
      end: 127,
      key: "tail",
      label: "tail",
      type: "opaque",
      tint: "rand-b",
      description: "Bytes after the variant.",
    },
  ],
};

// Validate a candidate layout array. Returns { ok, error, layout }.
// The schema rules match FIELD_FORMAT.md: each entry must have integer
// start/end in 0..127 with start <= end, a string key, a known type, and
// the entries must tile 0..127 contiguously without overlaps or gaps.
const KNOWN_TYPES = new Set([
  "timestamp-unix-ms",
  "gregorian-ticks",
  "version",
  "variant",
  "enum",
  "node-id",
  "integer-hex",
  "integer",
  "counter",
  "subms-tick",
  "static",
  "hash",
  "random",
  "opaque",
]);
const validateLayout = (raw) => {
  if (!Array.isArray(raw)) return { ok: false, error: "must be a JSON array" };
  const sorted = [...raw].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const seenKeys = new Set();
  let cursor = 0;
  for (const f of sorted) {
    if (typeof f !== "object" || f == null)
      return { ok: false, error: "each entry must be an object" };
    if (!Number.isInteger(f.start) || !Number.isInteger(f.end))
      return { ok: false, error: `non-integer bit range in "${f.key ?? "?"}"` };
    if (f.start < 0 || f.end > 127 || f.start > f.end)
      return { ok: false, error: `bad bit range [${f.start}..${f.end}]` };
    if (typeof f.key !== "string" || f.key.length === 0)
      return { ok: false, error: "every entry needs a string key" };
    if (seenKeys.has(f.key))
      return { ok: false, error: `duplicate key "${f.key}"` };
    seenKeys.add(f.key);
    if (typeof f.type !== "string" || !KNOWN_TYPES.has(f.type))
      return { ok: false, error: `unknown type "${f.type}" on "${f.key}"` };
    if (f.start !== cursor)
      return {
        ok: false,
        error:
          f.start < cursor
            ? `overlap at bit ${f.start} (in "${f.key}")`
            : `gap from bit ${cursor} to ${f.start - 1} before "${f.key}"`,
      };
    cursor = f.end + 1;
  }
  if (cursor !== 128)
    return { ok: false, error: `layout ends at bit ${cursor - 1}, expected 127` };
  return { ok: true, layout: sorted };
};

const fieldsFor = (b) => {
  // A custom layout, if loaded, overrides the built-in maps for everything
  // except nil/max — those are byte-pattern sentinels and ignore layout.
  if (isNilBytes(b)) return FIELDS.nil;
  if (isMaxBytes(b)) return FIELDS.max;
  if (state && state.customLayout) return state.customLayout;
  return FIELDS["v" + getVersion(b)] || FIELDS.unknown;
};

// ── v7 field map relabel/split based on the active generation knobs ──
// The on-the-wire bits are identical; the names just shift to describe
// what the current knob preset is actually putting into rand_a / rand_b.
//
// Mode precedence (mutually exclusive):
//   rand_b: monotonic  > rand_a: counter  > everything else
//
// 'counter' is now a 24-bit Method-1 counter spanning rand_a (hi 12) plus
// the top 12 of rand_b; 'sub-ms' is an 8-bit tick + 4-bit random padding.
const v7FieldsForKnobs = (fields, knobs) => {
  const mono = knobs.randBMode === "monotonic";
  const counter = !mono && knobs.randAMode === "counter";
  const subMs = !mono && !counter && knobs.randAMode === "sub-ms";
  const node = !mono && !counter && knobs.randBMode === "node";

  const out = [];
  for (const f of fields) {
    if (f.key === "randA") {
      if (mono)
        out.push({
          start: 52,
          end: 63,
          key: "monoA",
          label: "monotonic (hi)",
          type: "counter",
          group: "v7mono",
          groupOrder: 0,
          tint: "rand-a",
          specSection: "6.2",
          description:
            "Method 2: high 12 bits of a 74-bit monotonic payload. rand_a and rand_b together strictly increase within a ms.",
        });
      else if (counter)
        out.push({
          start: 52,
          end: 63,
          key: "counterHi",
          label: "counter (hi)",
          type: "counter",
          group: "v7counter",
          groupOrder: 0,
          tint: "rand-a",
          specSection: "6.2",
          description:
            "Method 1: high 12 bits of a 24-bit fixed-length counter. Increments on same-ms collisions; reseeds (23 bits) on a new ms.",
        });
      else if (subMs) {
        out.push({
          start: 52,
          end: 59,
          key: "subms",
          label: "sub-ms",
          type: "subms-tick",
          tint: "rand-a",
          specSection: "6.2",
          description:
            "Method 3: 8-bit sub-millisecond tick (~3.9 μs per step) derived from the high-resolution timer. Replaces the top 8 bits of rand_a.",
        });
        out.push({
          start: 60,
          end: 63,
          key: "subrand",
          label: "random",
          type: "integer-hex",
          tint: "rand-b",
          specSection: "6.2",
          description:
            "Method 3: 4-bit random padding in the low nibble of rand_a, kept random so that two UUIDs at the same sub-ms tick still differ.",
        });
      } else out.push(f);
    } else if (f.key === "randB") {
      if (mono)
        out.push({
          start: 66,
          end: 127,
          key: "monoB",
          label: "monotonic (lo)",
          type: "counter",
          group: "v7mono",
          groupOrder: 1,
          tint: "rand-a",
          specSection: "6.2",
          description:
            "Method 2: low 62 bits of the 74-bit monotonic payload. Increments by a small random delta per same-ms call.",
        });
      else if (counter) {
        out.push({
          start: 66,
          end: 77,
          key: "counterLo",
          label: "counter (lo)",
          type: "counter",
          group: "v7counter",
          groupOrder: 1,
          tint: "rand-a",
          specSection: "6.2",
          description:
            "Method 1: low 12 bits of the 24-bit counter — placed in the top of rand_b. The remaining 50 bits below are random.",
        });
        out.push({
          start: 78,
          end: 127,
          key: "randRest",
          label: "random",
          type: "random",
          tint: "rand-b",
          specSection: "5.7",
          description:
            "Random bits filling the remainder of rand_b after the counter.",
        });
      } else if (node) {
        out.push({
          start: 66,
          end: 81,
          key: "node",
          label: "node id",
          type: "node-id",
          tint: "node",
          specSection: "6.10",
          description:
            "Node identifier — 16 bits embedded in the high portion of rand_b.",
        });
        out.push({
          start: 82,
          end: 127,
          key: "randRest",
          label: "random",
          type: "random",
          tint: "rand-b",
          specSection: "5.7",
          description:
            "Random bits filling the remainder of rand_b after the node id.",
        });
      } else out.push(f);
    } else {
      out.push(f);
    }
  }
  return out;
};

const flipBit = (b, bitIdx) => {
  const out = new Uint8Array(b);
  const byteIdx = bitIdx >> 3;
  const bitInByte = 7 - (bitIdx & 7);
  out[byteIdx] ^= 1 << bitInByte;
  return out;
};

// ═══════════════════════════════════════════════════════════════════════
//  State + render scheduler
// ═══════════════════════════════════════════════════════════════════════

const STORAGE_KEY = "uuid-probe.v1";

const loadHistory = () => {
  try {
    const j = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { recent: j.recent || [], pinned: j.pinned || [] };
  } catch {
    return { recent: [], pinned: [] };
  }
};
const saveHistory = (h) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
  } catch {}
};

let state = {
  bytes: v7(),
  hovered: null, // hex digit index, 0..31
  hoveredField: null, // field.key
  view: "bits", // 'bits' | 'linear'
  focusedField: null, // briefly highlighted in linear walk after "jump"
  pasteValue: "",
  knobs: { randAMode: "random", randBMode: "random" },
  iface: {
    fieldTints: true,
    dashesInHex: true,
    showLayoutEditor: true,
    autoSaveHistory: true,
    uppercaseHex: false,
  },
  history: loadHistory(),
  modalOpen: false,
  customLayout: null, // validated array of field entries, or null
  customLayoutText: "", // textarea buffer
  customLayoutError: null,
};

let renderQueued = false;
// Tracks whether the about modal was open *before* this render — used to
// move focus into the modal exactly once when it opens.
let _modalWasOpen = false;
const update = (patch) => {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      rerender();
      if (state.modalOpen && !_modalWasOpen) {
        const closeBtn = document.getElementById("modal-close");
        if (closeBtn) closeBtn.focus();
      }
      _modalWasOpen = state.modalOpen;
    });
  }
};

// ─── Derived ──────────────────────────────────────────────────────────
const describe = (bytes) => {
  let base = fieldsFor(bytes);
  if (!isNilBytes(bytes) && !isMaxBytes(bytes) && getVersion(bytes) === 7) {
    base = v7FieldsForKnobs(base, state.knobs);
  }
  const fields = base.map((f) => ({
    ...f,
    label: f.label ?? f.key,
    color: tintColor(f.tint),
  }));
  return {
    bytes,
    fields,
    validation: validate(bytes),
    ver: getVersion(bytes),
    variant: getVariant(bytes),
    hex: bytesToHex(bytes),
    bits: bytesToBits(bytes),
  };
};

// Honor the uppercaseHex interface setting for any hex string we render.
const caseHex = (s) => (state.iface.uppercaseHex ? s.toUpperCase() : s);

const fromNow = (ms) => {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  const abs = Math.abs(sec);
  const sign = sec >= 0 ? "ago" : "from now";
  if (abs < 60) return `${abs}s ${sign}`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ${sign}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${sign}`;
  return `${Math.round(abs / 86400)}d ${sign}`;
};

// ═══════════════════════════════════════════════════════════════════════
//  DOM helper
// ═══════════════════════════════════════════════════════════════════════

const h = (tag, props, ...children) => {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object")
        Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function")
        el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled") el[k] = v;
      else el.setAttribute(k, v);
    }
  }
  const append = (c) => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) {
      c.forEach(append);
      return;
    }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(append);
  return el;
};

// ═══════════════════════════════════════════════════════════════════════
//  Actions
// ═══════════════════════════════════════════════════════════════════════

const pushRecent = (history, bytes) => {
  if (!state.iface.autoSaveHistory) return history;
  const hex = bytesToHex(bytes);
  const entry = { hex, at: Date.now(), ver: validate(bytes).kind };
  const dedup = history.recent.filter((r) => r.hex !== hex);
  const next = { ...history, recent: [entry, ...dedup].slice(0, 20) };
  saveHistory(next);
  return next;
};

const setBytes = (bytes, opts = {}) => {
  if (bytes && typeof bytes.then === "function") {
    bytes.then((b) => setBytes(b, opts));
    return;
  }
  update((s) => ({
    bytes,
    pasteValue: opts.keepPaste ? s.pasteValue : "",
    history: pushRecent(s.history, bytes),
  }));
};

const togglePinHex = (hex) => {
  update((s) => {
    const exists = s.history.pinned.find((p) => p.hex === hex);
    let pinned;
    if (exists) {
      pinned = s.history.pinned.filter((p) => p.hex !== hex);
    } else {
      const known = s.history.recent.find((r) => r.hex === hex);
      const ver = known
        ? known.ver
        : (() => {
            const b = parseUuid(hex);
            return b ? validate(b).kind : "?";
          })();
      pinned = [{ hex, at: Date.now(), ver }, ...s.history.pinned];
    }
    const history = { ...s.history, pinned };
    saveHistory(history);
    return { history };
  });
};
const togglePin = () => togglePinHex(bytesToHex(state.bytes));

// Single source of truth for the "generate one of these" map. Consumed by
// the Generate card, the regen button, and the ?gen= URL deep-link.
// v5 returns a Promise; setBytes unwraps it.
const GENERATORS = {
  v1: () => v1(),
  v2: () => v2(),
  v3: () => v3(NS_DNS, _nextHashName()),
  v4: () => v4(),
  v5: () => v5(NS_DNS, _nextHashName()),
  v6: () => v6(),
  v7: () =>
    v7({
      randAMode: state.knobs.randAMode,
      randBMode: state.knobs.randBMode,
    }),
  v8: () => v8(),
  nil: () => nilUuid(),
  max: () => maxUuid(),
};
const GEN_ORDER = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "nil", "max"];

const regen = () => {
  if (isNilBytes(state.bytes)) return setBytes(nilUuid());
  if (isMaxBytes(state.bytes)) return setBytes(maxUuid());
  const v = getVersion(state.bytes);
  const fn = GENERATORS["v" + v] || GENERATORS.v7;
  return setBytes(fn());
};

let focusTimer = null;
const jumpToLinear = (key) => {
  update({ view: "linear", focusedField: key });
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    update({ focusedField: null });
    focusTimer = null;
  }, 1500);
};

// The element to return focus to when the modal closes. Captured on open
// so the user lands back exactly where they triggered it.
let _modalReturn = null;
const openAbout = () => {
  _modalReturn = document.activeElement;
  update({ modalOpen: true });
};
const closeAbout = () => {
  update({ modalOpen: false });
  // Defer until after rerender — the trigger element may have been
  // replaced. We focus by id; if the original is gone, fall back to body.
  Promise.resolve().then(() => {
    const id = _modalReturn && _modalReturn.id;
    const el = id ? document.getElementById(id) : null;
    (el || document.body).focus();
    _modalReturn = null;
  });
};

const showToast = (msg = "copied") => {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("copy-toast--on");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("copy-toast--on"), 900);
};
const copy = (text) => {
  if (!navigator.clipboard) {
    showToast("clipboard unavailable");
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => showToast("copied"),
    () => showToast("copy denied"),
  );
};

// ═══════════════════════════════════════════════════════════════════════
//  Components
// ═══════════════════════════════════════════════════════════════════════

const Card = ({ title, hint, accent } = {}, ...children) =>
  h(
    "section",
    { class: "card" + (accent ? " card--accent" : "") },
    title &&
      h(
        "header",
        { class: "card__head" + (accent ? " card__head--accent" : "") },
        h("span", { class: "card__title" }, title),
        hint && h("span", { class: "card__hint" }, hint),
      ),
    h("div", { class: "card__body" }, ...children),
  );

// ── Spec links ────────────────────────────────────────────────────────
// Every reference to RFC 9562 in the probe goes through the local copy so
// readers can deep-link into the exact section, with errata pre-applied.
const SPEC_PAGE = "rfc9562.html";
const SPEC_HREF = (section) =>
  `${SPEC_PAGE}#section-${section.replace(/\./g, "-")}`;
const SpecRef = (section, label) =>
  h(
    "a",
    {
      href: SPEC_HREF(section),
      class: "spec-link",
      "data-tt": `RFC 9562 §${section} — opens local copy with errata`,
      "aria-label": `RFC 9562 section ${section}, opens local copy`,
    },
    label || `§${section} ↗`,
  );

// ── About modal ───────────────────────────────────────────────────────
const AboutModal = () =>
  h(
    "div",
    {
      class: "modal-overlay",
      onclick: closeAbout,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "about-title",
      // Tab trap: cycle focus between the first and last focusable nodes.
      onkeydown: (e) => {
        if (e.key !== "Tab") return;
        const root = e.currentTarget.querySelector(".modal");
        const focusables = root.querySelectorAll(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      },
    },
    h(
      "div",
      { class: "modal", onclick: (e) => e.stopPropagation() },
      h(
        "header",
        { class: "modal__head" },
        h(
          "span",
          { class: "modal__title", id: "about-title" },
          "About UUID Probe",
        ),
        h(
          "button",
          {
            id: "modal-close",
            class: "modal__close",
            "aria-label": "close",
            onclick: closeAbout,
          },
          "×",
        ),
      ),
      h(
        "div",
        { class: "modal__body" },
        h(
          "p",
          null,
          "A focused web tool for inspecting and learning about ",
          h("strong", null, "RFC 9562"),
          " UUIDs. Paste any UUID and see how its bits and fields decompose; generate v1 through v8 with a click; cross-highlighted bit grid and linear walk make the structure of the spec tangible.",
        ),
        h(
          "p",
          null,
          "Built with vanilla JavaScript — no frameworks, no build step. Two files, ready to open in any browser.",
        ),
        h(
          "dl",
          { class: "modal__dl" },
          h("dt", null, "Author"),
          h(
            "dd",
            null,
            h(
              "a",
              {
                href: "https://github.com/robinpokorny",
                target: "_blank",
                rel: "noopener noreferrer",
              },
              "Robin Pokorny",
            ),
          ),
          h("dt", null, "Source"),
          h(
            "dd",
            null,
            h(
              "a",
              {
                href: "https://github.com/robinpokorny/uuid-probe",
                target: "_blank",
                rel: "noopener noreferrer",
              },
              "github.com/robinpokorny/uuid-probe",
            ),
          ),
          h("dt", null, "Spec"),
          h(
            "dd",
            null,
            h("a", { href: "rfc9562.html" }, "RFC 9562 (local copy)"),
            h("span", { class: "t-ink3" }, " · canonical: "),
            h(
              "a",
              {
                href: "https://www.rfc-editor.org/rfc/rfc9562",
                target: "_blank",
                rel: "noopener noreferrer",
              },
              "rfc-editor.org ↗",
            ),
          ),
          h("dt", null, "License"),
          h("dd", null, "MIT"),
        ),
        h(
          "p",
          { class: "modal__foot" },
          h("span", { class: "t-ink3" }, "press "),
          h("kbd", { class: "modal__kbd" }, "Esc"),
          h("span", { class: "t-ink3" }, " or click outside to close"),
        ),
      ),
    ),
  );

// ── Header ────────────────────────────────────────────────────────────
const Header = () =>
  h(
    "div",
    { class: "header" },
    h("div", { class: "header__eyebrow" }, "Probe · Inspect"),
    h("div", { class: "header__title" }, "Decode any UUID."),
  );

// ── Input bar ─────────────────────────────────────────────────────────
const InputBar = (desc, pretty) => {
  const isPinned = state.history.pinned.some((p) => p.hex === desc.hex);
  const validity = desc.validation.valid
    ? h("span", { class: "pill pill--ok" }, "✓ " + desc.validation.kind)
    : h(
        "span",
        { class: "pill pill--err" },
        "! " +
          desc.validation.kind +
          (desc.validation.issues[0] ? " · " + desc.validation.issues[0] : ""),
      );
  const display = state.iface.dashesInHex ? pretty : desc.hex;
  const inputVal =
    state.pasteValue ||
    (state.iface.uppercaseHex ? display.toUpperCase() : display);

  return h(
    "div",
    { class: "input-bar" },
    h(
      "div",
      { class: "input-wrap" },
      h(
        "div",
        { class: "input-wrap__inner" },
        h("span", { class: "input-label" }, "UUID:"),
        h("input", {
          id: "uuid-input",
          class: "input-uuid",
          value: inputVal,
          placeholder: "paste any UUID — dashes optional",
          spellcheck: "false",
          autocomplete: "off",
          autocorrect: "off",
          autocapitalize: "off",
          oninput: (e) => {
            const v = e.target.value;
            const parsed = parseUuid(v);
            if (parsed)
              update((s) => ({
                pasteValue: v,
                bytes: parsed,
                history: pushRecent(s.history, parsed),
              }));
            else update({ pasteValue: v });
          },
          onblur: () => {
            if (parseUuid(state.pasteValue)) update({ pasteValue: "" });
          },
        }),
        h(
          "div",
          { class: "input-tools" },
          validity,
          h(
            "button",
            { class: "btn btn--small btn--ghost", onclick: () => copy(pretty) },
            "📋 copy",
          ),
          h(
            "button",
            {
              class:
                "btn btn--small btn--ghost btn--dashed" +
                (isPinned ? " btn--pinned" : ""),
              onclick: togglePin,
            },
            isPinned ? "📌 pinned" : "📌 pin",
          ),
        ),
      ),
    ),
    h("button", { class: "btn btn--primary", onclick: regen }, "↻ new"),
  );
};

// ── Generate card ─────────────────────────────────────────────────────
const GenerateCard = (desc) =>
  Card(
    { title: "Generate" },
    ...GEN_ORDER.map((k) =>
      h(
        "button",
        {
          type: "button",
          class:
            "gen-row" + (desc.validation.kind === k ? " gen-row--active" : ""),
          onclick: () => setBytes(GENERATORS[k]()),
          "aria-label": `generate ${k}`,
        },
        h("span", { class: "gen-row__label" }, k),
        h("span", { class: "gen-row__icon" }, "↻"),
      ),
    ),
  );

// ── Interface settings card ───────────────────────────────────────────
const SettingRow = (label, on, onChange) =>
  h(
    "button",
    {
      type: "button",
      class: "set-row",
      role: "switch",
      "aria-checked": on ? "true" : "false",
      onclick: () => onChange(!on),
    },
    h("span", { class: "set-row__label" }, label),
    h(
      "span",
      { class: "toggle" + (on ? " toggle--on" : "") },
      h("span", { class: "toggle__dot" }),
    ),
  );

const InterfaceCard = () =>
  Card(
    { title: "interface" },
    SettingRow("field tints", state.iface.fieldTints, (v) =>
      update((s) => ({ iface: { ...s.iface, fieldTints: v } })),
    ),
    SettingRow("dashes in hex", state.iface.dashesInHex, (v) =>
      update((s) => ({ iface: { ...s.iface, dashesInHex: v } })),
    ),
    SettingRow("show field layout", state.iface.showLayoutEditor, (v) =>
      update((s) => ({ iface: { ...s.iface, showLayoutEditor: v } })),
    ),
    SettingRow("auto-save history", state.iface.autoSaveHistory, (v) =>
      update((s) => ({ iface: { ...s.iface, autoSaveHistory: v } })),
    ),
    SettingRow("uppercase hex", state.iface.uppercaseHex, (v) =>
      update((s) => ({ iface: { ...s.iface, uppercaseHex: v } })),
    ),
  );

// ── Custom layout card ────────────────────────────────────────────────
// Hands the user the layout-schema contract (FIELD_FORMAT.md). Paste JSON
// or load a file; the parsed entries override the built-in layout for
// versioned UUIDs. Round-trippable via the "export current" button.
const applyCustomLayoutText = (text) => {
  if (!text || !text.trim()) {
    update({
      customLayout: null,
      customLayoutText: "",
      customLayoutError: null,
    });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    update({ customLayoutText: text, customLayoutError: "invalid JSON: " + e.message });
    return;
  }
  const result = validateLayout(parsed);
  if (!result.ok) {
    update({ customLayoutText: text, customLayoutError: result.error });
    return;
  }
  update({
    customLayout: result.layout,
    customLayoutText: text,
    customLayoutError: null,
  });
};

const CustomLayoutCard = (desc) =>
  Card(
    {
      title: "custom layout",
      hint: state.customLayout ? "active · overrides built-in" : "paste schema JSON",
    },
    h("textarea", {
      id: "custom-layout-text",
      class: "custom-layout__text",
      placeholder:
        '[\n  { "start": 0, "end": 47, "key": "ts", "type": "timestamp-unix-ms",\n    "label": "unix_ts_ms", "tint": "timestamp" },\n  ...\n]',
      spellcheck: "false",
      oninput: (e) => update({ customLayoutText: e.target.value }),
      value: state.customLayoutText,
    }),
    state.customLayoutError
      ? h("div", { class: "custom-layout__err" }, "⚠ " + state.customLayoutError)
      : null,
    h(
      "div",
      { class: "row-gap row-gap--mt-sm" },
      h(
        "button",
        {
          type: "button",
          class: "btn btn--small btn--primary",
          onclick: () => applyCustomLayoutText(state.customLayoutText),
        },
        "apply",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn--small",
          onclick: () => {
            const layout = describe(state.bytes).fields.map((f) => {
              const { color, ...rest } = f;
              return rest;
            });
            update({
              customLayoutText: JSON.stringify(layout, null, 2),
              customLayoutError: null,
            });
          },
        },
        "load current",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn--small",
          onclick: () => {
            const inp = document.getElementById("custom-layout-file");
            if (inp) inp.click();
          },
        },
        "open file…",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn--small",
          disabled: !state.customLayout && !state.customLayoutText,
          onclick: () =>
            update({
              customLayout: null,
              customLayoutText: "",
              customLayoutError: null,
            }),
        },
        "clear",
      ),
    ),
    h("input", {
      id: "custom-layout-file",
      type: "file",
      accept: "application/json,.json",
      class: "custom-layout__file",
      onchange: (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => applyCustomLayoutText(String(reader.result));
        reader.readAsText(file);
        e.target.value = "";
      },
    }),
  );

// ── Hex line with per-nibble segments and partial highlighting ────────
const segmentsFor = (i, fields) => {
  const ns = i * 4,
    ne = i * 4 + 3;
  const out = [];
  for (const f of fields) {
    const s = Math.max(f.start, ns);
    const e = Math.min(f.end, ne);
    if (s <= e) out.push({ field: f, localStart: s - ns, localEnd: e - ns });
  }
  return out;
};

const HexLine = (desc) => {
  const hex = state.iface.uppercaseHex ? desc.hex.toUpperCase() : desc.hex;
  const fields = state.iface.fieldTints ? desc.fields : [];
  const groupBoundaries = new Set([8, 12, 16, 20]);
  const out = [];
  for (let i = 0; i < hex.length; i++) {
    const segs = segmentsFor(i, fields);
    const isPartial = segs.length > 1;
    const isHov = state.hovered === i;
    const fullHov =
      state.hoveredField &&
      segs.length > 0 &&
      segs.every((s) => s.field.key === state.hoveredField);
    const partial =
      state.hoveredField && !fullHov
        ? segs.find((s) => s.field.key === state.hoveredField)
        : null;
    const lit = isHov || fullHov;

    out.push(
      h(
        "div",
        {
          class: "hex__digit",
          onmouseenter: () => update({ hovered: i, hoveredField: null }),
          onmouseleave: () => update({ hovered: null }),
        },
        h(
          "div",
          {
            class:
              "hex__char" +
              (lit ? " hex__char--lit" : "") +
              (isPartial ? " hex__char--partial" : ""),
          },
          partial &&
            h("div", {
              class: "hex__partial",
              style: {
                left: `${(partial.localStart / 4) * 100}%`,
                width: `${((partial.localEnd - partial.localStart + 1) / 4) * 100}%`,
                borderLeft:
                  partial.localStart === 0
                    ? "1.5px solid var(--accent)"
                    : "none",
                borderRight:
                  partial.localEnd === 3 ? "1.5px solid var(--accent)" : "none",
              },
            }),
          h("span", { class: "hex__char-glyph" }, hex[i]),
        ),
        h(
          "div",
          { class: "hex__under" },
          segs.length === 0
            ? h("div", { class: "hex__seg-empty" })
            : segs.map((s, si) =>
                h("div", {
                  class:
                    "hex__seg" +
                    (state.hoveredField === s.field.key
                      ? " hex__seg--hov"
                      : ""),
                  style: {
                    flex: String(s.localEnd - s.localStart + 1),
                    background: s.field.color,
                    borderRight:
                      si < segs.length - 1 ? "1px solid var(--ink)" : undefined,
                  },
                }),
              ),
        ),
      ),
    );
    if (groupBoundaries.has(i + 1))
      out.push(h("div", { class: "hex__dash" }, "-"));
  }
  return h("div", { class: "hex" }, ...out);
};

// ── Field chip ────────────────────────────────────────────────────────
const FieldChip = (f, active) =>
  h(
    "span",
    {
      class: "chip" + (active ? " chip--active" : ""),
      style: { background: f.color },
      onmouseenter: () => update({ hoveredField: f.key, hovered: null }),
      onmouseleave: () => update({ hoveredField: null }),
    },
    h("span", { class: "chip__label" }, f.label),
    h("span", { class: "chip__size" }, f.end - f.start + 1 + "b"),
  );

const HexCard = (desc) =>
  Card(
    { title: "hex", hint: "hover a nibble · 4 bits highlight", accent: true },
    h("div", { class: "hex-scroll" }, HexLine(desc)),
    h(
      "div",
      { class: "chips" },
      ...desc.fields.map((f) => FieldChip(f, state.hoveredField === f.key)),
    ),
  );

// ── View switcher ─────────────────────────────────────────────────────
const ViewSwitcher = () =>
  h(
    "div",
    { class: "view-switch-wrap" },
    h("span", { class: "t-ink3 fs-12" }, "view:"),
    h(
      "div",
      { class: "view-switch" },
      ...[
        ["bits", "bit grid"],
        ["linear", "linear · narrated"],
      ].map(([k, label]) =>
        h(
          "button",
          {
            class:
              "view-switch__btn" +
              (state.view === k ? " view-switch__btn--active" : ""),
            onclick: () => update({ view: k }),
          },
          label,
        ),
      ),
    ),
  );

// ── Bit grid: 4 rows of 32 bits, grouped 4 + 8 ────────────────────────
const BitGrid = (desc) => {
  const fields = state.iface.fieldTints ? desc.fields : [];
  const fieldAt = (i) => fields.find((f) => i >= f.start && i <= f.end);
  const perRow = 32;
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const bits = [];
    for (let c = 0; c < perRow; c++) {
      const i = r * perRow + c;
      const f = fieldAt(i);
      const hexIdx = Math.floor(i / 4);
      const isHov = state.hovered === hexIdx;
      const isOne = desc.bits[i] === "1";
      let mr = 0;
      if (c < perRow - 1) {
        if ((c + 1) % 8 === 0) mr = 12;
        else if ((c + 1) % 4 === 0) mr = 6;
        else mr = 1;
      }
      bits.push(
        h("button", {
          type: "button",
          class: "bg__bit" + (isHov ? " bg__bit--hov" : ""),
          // Delegated mousedown handler on #root reads this to flip the bit.
          // Per-bit onclick is unreliable because the rerender that fires
          // on mouseenter can replace the element between mousedown and
          // mouseup, in which case the browser fires no native click event.
          "data-bit-idx": String(i),
          "aria-label": `bit ${i}: ${isOne ? "1" : "0"}${f ? ", field " + (f.label || f.key) : ""}. Press to flip.`,
          "aria-pressed": isOne ? "true" : "false",
          // Keep focus stable across rerenders so arrow-key navigation works.
          id: "bg-bit-" + i,
          style: {
            marginRight: mr + "px",
            background: isOne ? "var(--ink)" : f ? f.color : "transparent",
            boxShadow:
              isOne && f
                ? `inset 0 -3px 0 0 ${f.color}`
                : !isOne && f
                  ? `inset 0 0 0 1px ${f.color}`
                  : "none",
          },
          onmouseenter: () => update({ hovered: hexIdx, hoveredField: null }),
          onmouseleave: () => update({ hovered: null }),
          onfocus: () => update({ hovered: hexIdx, hoveredField: null }),
          onblur: () => update({ hovered: null }),
          onkeydown: (e) => {
            // Arrow keys move focus across the 128-bit grid. Space/Enter flip.
            const moves = {
              ArrowLeft: -1,
              ArrowRight: 1,
              ArrowUp: -perRow,
              ArrowDown: perRow,
              Home: -i,
              End: 127 - i,
            };
            if (e.key in moves) {
              e.preventDefault();
              const next = Math.max(0, Math.min(127, i + moves[e.key]));
              const el = document.getElementById("bg-bit-" + next);
              if (el) el.focus();
            } else if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              setBytes(flipBit(state.bytes, i));
            }
          },
        }),
      );
    }
    rows.push(h("div", { class: "bg__row", role: "row" }, ...bits));
  }
  return h(
    "div",
    {
      class: "bg",
      role: "grid",
      "aria-label": "128-bit UUID grid. Arrow keys navigate, Space or Enter flip.",
    },
    ...rows,
  );
};

const BitsCard = (desc) =>
  Card(
    { title: "bits", hint: "click or arrow keys + space · hover to scan" },
    BitGrid(desc),
  );

// ── Linear walk ───────────────────────────────────────────────────────
// Pull a big-endian integer out of an inclusive bit range.
const bigIntFromRange = (bytes, start, end) => {
  let n = 0n;
  for (let i = start; i <= end; i++) {
    const byte = bytes[i >> 3];
    const bit = (byte >> (7 - (i & 7))) & 1;
    n = (n << 1n) | BigInt(bit);
  }
  return n;
};

// Combine all sibling fields sharing the same `group` key. They're stitched
// MSB-first in `groupOrder` ascending so a 24-bit counter split across the
// variant boundary (groupOrder 0 = high 12, groupOrder 1 = low 12) decodes
// as one integer.
const combineGroup = (bytes, fields, group) => {
  const siblings = fields
    .filter((f) => f.group === group)
    .sort(
      (a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0) || a.start - b.start,
    );
  let n = 0n;
  let width = 0;
  for (const sib of siblings) {
    const w = sib.end - sib.start + 1;
    n = (n << BigInt(w)) | bigIntFromRange(bytes, sib.start, sib.end);
    width += w;
  }
  return { value: n, width };
};

// Format a BigInt as zero-padded hex of `width` bits.
const padHex = (n, width) => n.toString(16).padStart(Math.ceil(width / 4), "0");

// Normalize a static `value` (hex string with optional 0x prefix, or a
// number/BigInt) to a width-padded lowercase hex string with no prefix.
const normalizeStaticValue = (v, width) => {
  const hexLen = Math.ceil(width / 4);
  if (typeof v === "string") {
    const h = v.toLowerCase().replace(/^0x/, "");
    return h.padStart(hexLen, "0").slice(-hexLen);
  }
  const big = typeof v === "bigint" ? v : BigInt(v);
  return big.toString(16).padStart(hexLen, "0");
};

// Best-effort decoded representation for a single field. Branches on
// `f.type`; falls back to a hex slice for unknown / opaque types.
const decodedFor = (desc, f) => {
  // For grouped fields we combine all siblings; otherwise just this entry.
  const own = () => ({
    value: bigIntFromRange(desc.bytes, f.start, f.end),
    width: f.end - f.start + 1,
  });
  const combined = () =>
    f.group ? combineGroup(desc.bytes, desc.fields, f.group) : own();

  switch (f.type) {
    case "timestamp-unix-ms": {
      const { value } = own();
      const ms = Number(value);
      return {
        primary: new Date(ms)
          .toISOString()
          .replace("T", " ")
          .replace("Z", " UTC"),
        aux: "↳ " + fromNow(ms),
      };
    }
    case "gregorian-ticks": {
      // Group-aware: when the field is part of a combined Gregorian
      // timestamp, show the date; when displayed in isolation, show hex.
      if (f.group) {
        const { value } = combined();
        const ms = Number(value / 10000n) - 12219292800000;
        return {
          primary: new Date(ms)
            .toISOString()
            .replace("T", " ")
            .replace("Z", " UTC"),
          aux: "↳ " + fromNow(ms),
        };
      }
      const startHex = Math.floor(f.start / 4),
        endHex = Math.floor(f.end / 4);
      return { primary: "0x" + desc.hex.slice(startHex, endHex + 1) };
    }
    case "version":
      return {
        primary: `0x${desc.ver.toString(16)}  (${desc.validation.kind})`,
      };
    case "variant":
      return { primary: `${desc.variant} variant` };
    case "enum": {
      const v = Number(own().value);
      const name = f.values?.[v];
      return { primary: name ? `${v}  (${name})` : `${v}` };
    }
    case "node-id":
    case "integer-hex": {
      const { value, width } = own();
      return { primary: `0x${padHex(value, width)}  (${value})` };
    }
    case "integer":
      return { primary: own().value.toString() };
    case "counter": {
      const { value, width } = combined();
      return {
        primary: `${value}  (0x${padHex(value, width)} · ${width}-bit)`,
      };
    }
    case "subms-tick": {
      const { value, width } = own();
      const v = Number(value);
      const max = 1 << width;
      return {
        primary: `${v}/${max}  (~${((v * 1000) / max).toFixed(0)} µs into the ms)`,
      };
    }
    case "static": {
      const { value: actual, width } = own();
      const actualHex = padHex(actual, width);
      if (f.value == null) return { primary: `0x${actualHex}` };
      const declared = normalizeStaticValue(f.value, width);
      const matches = actualHex === declared;
      return matches
        ? { primary: f.label, aux: `↳ static value 0x${declared} ✓` }
        : {
            primary: `0x${actualHex}`,
            aux: `⚠ declared 0x${declared} — does not match`,
          };
    }
    case "hash":
    case "random":
    case "opaque":
    default: {
      const startHex = Math.floor(f.start / 4),
        endHex = Math.floor(f.end / 4);
      return { primary: "0x" + desc.hex.slice(startHex, endHex + 1) };
    }
  }
};

const LinearWalk = (desc) =>
  h(
    "div",
    null,
    ...desc.fields.map((f, i) => {
      const startHex = Math.floor(f.start / 4),
        endHex = Math.floor(f.end / 4);
      const sourceHex = state.iface.uppercaseHex
        ? desc.hex.toUpperCase()
        : desc.hex;
      const hexSlice = sourceHex.slice(startHex, endHex + 1);
      const bitsSlice = desc.bits.slice(f.start, f.end + 1);
      const dec = decodedFor(desc, f);
      const isHov =
        state.hoveredField === f.key || state.focusedField === f.key;
      const explain = f.description;
      const specSec = f.specSection;
      return h(
        "div",
        {
          class: "lw__row" + (isHov ? " lw__row--hov" : ""),
          onmouseenter: () => update({ hoveredField: f.key, hovered: null }),
          onmouseleave: () => update({ hoveredField: null }),
        },
        h("div", { class: "lw__num" }, String(i + 1)),
        h(
          "div",
          null,
          h(
            "div",
            { class: "lw__head" },
            FieldChip(f, isHov),
            h(
              "span",
              { class: "t-ink3 fs-11" },
              `bits ${f.start}–${f.end} · ${Math.ceil((f.end - f.start + 1) / 4)} hex chars`,
            ),
          ),
          h(
            "div",
            { class: "lw__data" },
            h(
              "div",
              { class: "lw__hex", style: { background: f.color } },
              h("span", { class: "mono fs-16 fw-600" }, hexSlice),
            ),
            h(
              "div",
              { class: "lw__col" },
              h("span", { class: "lw__col-label" }, "bits"),
              h(
                "div",
                { class: "lw__bits" },
                ...[...bitsSlice].map((b, j) =>
                  h("div", {
                    class:
                      "lw__bit" +
                      ((j + 1) % 4 === 0 ? " lw__bit--nibble-end" : ""),
                    style: { background: b === "1" ? "var(--ink)" : f.color },
                  }),
                ),
              ),
            ),
            h(
              "div",
              { class: "lw__col" },
              h("span", { class: "lw__col-label" }, "decoded"),
              h("span", { class: "mono fs-12" }, dec.primary),
              dec.aux && h("span", { class: "t-ink3 fs-11" }, dec.aux),
            ),
          ),
          (explain || specSec) &&
            h(
              "span",
              { class: "lw__explain" },
              explain || null,
              specSec
                ? [" ", SpecRef(specSec, `RFC 9562 §${specSec} ↗`)]
                : null,
            ),
        ),
      );
    }),
  );

const LinearCard = (desc) =>
  Card({ title: "linear · region-by-region" }, LinearWalk(desc));

// ── Field layout strip ────────────────────────────────────────────────
const FieldLayoutCard = (desc) =>
  Card(
    {
      title: "field layout",
      hint:
        desc.ver === 7
          ? "tracks the active v7 knobs"
          : "visual layout for this version",
    },
    h(
      "div",
      { class: "layout-strip" },
      ...desc.fields.map((f) =>
        h(
          "div",
          {
            class: "layout-seg",
            style: { flex: String(f.end - f.start + 1), background: f.color },
            onmouseenter: () => update({ hoveredField: f.key, hovered: null }),
            onmouseleave: () => update({ hoveredField: null }),
          },
          h("span", { class: "layout-seg__label" }, f.label),
          h("span", { class: "layout-seg__size" }, f.end - f.start + 1 + "b"),
        ),
      ),
    ),
  );

// ── v7 knobs ──────────────────────────────────────────────────────────
const RAND_A_OPTS = [
  { k: "random", label: "random" },
  { k: "counter", label: "counter" },
  { k: "sub-ms", label: "sub-ms" },
];
const RAND_B_OPTS = [
  { k: "random", label: "random" },
  { k: "monotonic", label: "monotonic" },
  { k: "node", label: "+ node id" },
];

// Each method-bearing option points at the same RFC §6.2 (where the three
// monotonicity methods live); 'node' has its own section in §6.10/§6.11.
const RAND_A_HELP = {
  random: {
    method: null,
    section: null,
    text: "12 fresh random bits per UUID. The default — collisions within a ms are possible but vanishingly rare.",
  },
  counter: {
    method: "Method 1",
    section: "6.2",
    text: "24-bit fixed-length counter spanning rand_a (high 12) and the top 12 of rand_b. Increments on same-ms collisions; reseeds with 23 random bits on a new ms (leftmost bit cleared for rollover protection). Overrides rand_b.",
  },
  "sub-ms": {
    method: "Method 3",
    section: "6.2",
    text: "Top 8 bits of rand_a are a sub-millisecond tick (~3.9 μs per step) derived from the high-resolution timer; the bottom 4 bits stay random so simultaneous calls still differ.",
  },
};
const RAND_B_HELP = {
  random: {
    method: null,
    section: null,
    text: "62 fresh random bits per UUID.",
  },
  monotonic: {
    method: "Method 2",
    section: "6.2",
    text: "rand_a and rand_b together (74 bits) act as one strictly-increasing counter. On same-ms collisions: previous payload + a small random delta (≤ 30-bit, ≥ 1). Overrides rand_a.",
  },
  node: {
    method: null,
    section: "6.10",
    text: "Top 16 bits of rand_b carry a fixed node identifier; the remaining 46 bits stay random.",
  },
};

// Applying one of the named methods clears the conflicting knob.
const applyMethod = (randAMode, randBMode) => {
  update((s) => ({ knobs: { ...s.knobs, randAMode, randBMode } }));
  setBytes(v7({ randAMode, randBMode }));
};

const KnobHelp = (help) =>
  h(
    "div",
    { class: "knob__help" },
    help.method
      ? h("strong", { class: "t-accent" }, help.method + " · ")
      : null,
    help.text,
    " ",
    help.section ? SpecRef(help.section, `RFC 9562 §${help.section} ↗`) : null,
  );

const KnobsCard = () => {
  const mono = state.knobs.randBMode === "monotonic";
  const counter = !mono && state.knobs.randAMode === "counter";
  const randADim = mono; // monotonic owns rand_a
  const randBDim = counter; // counter owns rand_b high bits

  return Card(
    { title: "v7 knobs", accent: true },
    h(
      "div",
      { class: "knob" },
      h(
        "div",
        { class: "knob__label" },
        "rand_a (12b)",
        randADim
          ? h(
              "span",
              { class: "t-ink3 ml-6" },
              "· set by monotonic mode",
            )
          : null,
      ),
      h(
        "div",
        {
          class: "knob__opts",
          style: randADim ? { opacity: "0.45", pointerEvents: "none" } : null,
        },
        ...RAND_A_OPTS.map(({ k, label }) =>
          h(
            "button",
            {
              type: "button",
              class:
                "pill pill--btn" +
                (state.knobs.randAMode === k ? " pill--accent" : ""),
              "data-tt": RAND_A_HELP[k].text,
              "aria-pressed": state.knobs.randAMode === k ? "true" : "false",
              onclick: () =>
                update((s) => {
                  // Switching out of counter releases rand_b. Switching into counter
                  // forces rand_b to 'random' so the two modes don't fight.
                  const next = { ...s.knobs, randAMode: k };
                  if (k === "counter") next.randBMode = "random";
                  return { knobs: next };
                }),
            },
            label,
          ),
        ),
      ),
      KnobHelp(RAND_A_HELP[state.knobs.randAMode]),
    ),

    h(
      "div",
      { class: "knob" },
      h(
        "div",
        { class: "knob__label" },
        "rand_b (62b)",
        randBDim
          ? h(
              "span",
              { class: "t-ink3 ml-6" },
              "· set by counter mode",
            )
          : null,
      ),
      h(
        "div",
        {
          class: "knob__opts",
          style: randBDim ? { opacity: "0.45", pointerEvents: "none" } : null,
        },
        ...RAND_B_OPTS.map(({ k, label }) =>
          h(
            "button",
            {
              type: "button",
              class:
                "pill pill--btn" +
                (state.knobs.randBMode === k ? " pill--accent" : ""),
              "data-tt": RAND_B_HELP[k].text,
              "aria-pressed": state.knobs.randBMode === k ? "true" : "false",
              onclick: () =>
                update((s) => {
                  const next = { ...s.knobs, randBMode: k };
                  if (k === "monotonic") next.randAMode = "random";
                  return { knobs: next };
                }),
            },
            label,
          ),
        ),
      ),
      KnobHelp(RAND_B_HELP[state.knobs.randBMode]),
    ),

    h(
      "div",
      { class: "row-gap row-gap--mt" },
      h(
        "button",
        { class: "btn btn--small btn--primary", onclick: regen },
        "↻ regen",
      ),
    ),
    h(
      "div",
      { class: "row-gap row-gap--mt-sm" },
      h(
        "button",
        {
          class: "btn btn--small btn--dashed",
          "data-tt": RAND_A_HELP.counter.text,
          onclick: () => applyMethod("counter", "random"),
        },
        "fixed counter (M1)",
      ),
      h(
        "button",
        {
          class: "btn btn--small btn--dashed",
          "data-tt": RAND_B_HELP.monotonic.text,
          onclick: () => applyMethod("random", "monotonic"),
        },
        "monotonic (M2)",
      ),
    ),
  );
};

// ── Parsed values ─────────────────────────────────────────────────────
const ParsedRow = ({ label, onClick }, ...children) =>
  h(
    "div",
    {
      class: "parsed-row" + (onClick ? " parsed-row--link" : ""),
      onclick: onClick,
    },
    h(
      "div",
      { class: "parsed-row__head" },
      h("span", { class: "parsed-row__label" }, label),
      onClick && h("span", { class: "parsed-row__hint" }, "view in linear →"),
    ),
    h("div", { class: "parsed-row__body" }, ...children),
  );

const ParsedCard = (desc) => {
  const rows = [];
  if (desc.ver === 7) {
    const ms = v7Timestamp(desc.bytes);
    rows.push(
      ParsedRow(
        { label: "timestamp", onClick: () => jumpToLinear("ts") },
        h(
          "div",
          { class: "hand fs-13" },
          new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC"),
        ),
        h("div", { class: "t-ink3 fs-11" }, "↳ " + fromNow(ms)),
      ),
      ParsedRow(
        { label: "rand_a (12b)", onClick: () => jumpToLinear("randA") },
        h(
          "span",
          { class: "mono fs-12" },
          "0x" + caseHex(v7RandA(desc.bytes).toString(16).padStart(3, "0")),
        ),
      ),
      ParsedRow(
        { label: "rand_b (62b)", onClick: () => jumpToLinear("randB") },
        h(
          "span",
          { class: "mono fs-12 break" },
          "0x" + caseHex(v7RandBHex(desc.bytes)),
        ),
      ),
    );
  } else {
    rows.push(
      ParsedRow(
        { label: "version" },
        h("span", { class: "hand fs-13" }, desc.validation.kind),
      ),
      ParsedRow(
        { label: "variant" },
        h("span", { class: "hand fs-13" }, desc.variant),
      ),
      ParsedRow(
        { label: "bytes" },
        h("span", { class: "mono fs-11 break" }, caseHex(desc.hex)),
      ),
    );
    if (desc.validation.issues.length > 0) {
      rows.push(
        ParsedRow(
          { label: "issues" },
          ...desc.validation.issues.map((i) =>
            h("div", { class: "parsed-issue fs-11" }, "· " + i),
          ),
        ),
      );
    }
  }
  return Card(
    { title: "parsed", hint: desc.ver === 7 ? "click → linear" : undefined },
    ...rows,
  );
};

// ── Formats card ──────────────────────────────────────────────────────
const FormatRow = (label, value) =>
  h(
    "div",
    { class: "format-row" },
    h("span", { class: "format-row__label" }, label),
    h(
      "button",
      {
        type: "button",
        class: "format-row__value",
        onclick: () => copy(value),
        "data-tt": "click to copy",
        "aria-label": `copy ${label}: ${value}`,
      },
      value,
    ),
  );

const FormatsCard = (desc) => {
  const pretty = caseHex(formatPretty(desc.bytes));
  return Card(
    { title: "formats", hint: "click to copy" },
    FormatRow("pretty", pretty),
    FormatRow("raw hex", caseHex(desc.hex)),
    FormatRow("urn", `urn:uuid:${pretty}`),
    FormatRow("base64", bytesToBase64(desc.bytes)),
    FormatRow("base32 · ULID", bytesToBase32Crockford(desc.bytes)),
    FormatRow("uint128", bytesToBigInt(desc.bytes).toString()),
  );
};

// ── History strip ─────────────────────────────────────────────────────
const HistoryCardEl = (item, pinned) =>
  h(
    "div",
    {
      class: "history-card" + (pinned ? " history-card--pinned" : ""),
      onclick: () => {
        const b = parseUuid(item.hex);
        if (b) setBytes(b);
      },
      title: item.hex,
    },
    h(
      "div",
      { class: "history-card__head" },
      h("span", { class: "pill pill--xs" }, item.ver),
      h(
        "button",
        {
          type: "button",
          class: "pin-toggle" + (pinned ? " pin-toggle--on" : ""),
          "data-tt": pinned ? "unpin" : "pin",
          "aria-label": (pinned ? "unpin " : "pin ") + item.hex,
          "aria-pressed": pinned ? "true" : "false",
          onclick: (e) => {
            e.stopPropagation();
            togglePinHex(item.hex);
          },
        },
        "📌",
      ),
    ),
    h(
      "div",
      { class: "history-card__hex mono fs-11" },
      caseHex(`${item.hex.slice(0, 8)}-${item.hex.slice(8, 12)}-…`),
    ),
    h("div", { class: "history-card__age t-ink3 fs-10" }, fromNow(item.at)),
  );

const HistoryStrip = () =>
  h(
    "div",
    { class: "history-wrap" },
    Card(
      { title: "history", hint: "click to load · ★ to pin" },
      h(
        "div",
        { class: "history-strip" },
        ...(state.history.pinned.length + state.history.recent.length === 0
          ? [
              h(
                "span",
                { class: "t-ink3 fs-12" },
                "nothing yet — generate or paste a UUID",
              ),
            ]
          : [
              ...state.history.pinned.map((it) => HistoryCardEl(it, true)),
              ...state.history.recent
                .slice(0, 10)
                .map((it) => HistoryCardEl(it, false)),
            ]),
      ),
    ),
  );

// ── App root ──────────────────────────────────────────────────────────
const App = () => {
  const desc = describe(state.bytes);
  const pretty = formatPretty(desc.bytes);
  return h(
    "div",
    { class: "app" },
    Header(),
    InputBar(desc, pretty),
    h(
      "div",
      { class: "grid" },
      h(
        "div",
        { class: "col" },
        GenerateCard(desc),
        InterfaceCard(),
        CustomLayoutCard(desc),
      ),
      h(
        "div",
        { class: "col" },
        HexCard(desc),
        ViewSwitcher(),
        state.view === "bits" ? BitsCard(desc) : LinearCard(desc),
        state.view === "bits" && state.iface.showLayoutEditor
          ? FieldLayoutCard(desc)
          : null,
      ),
      h(
        "div",
        { class: "col" },
        desc.ver === 7 && desc.validation.valid ? KnobsCard() : null,
        ParsedCard(desc),
        FormatsCard(desc),
      ),
    ),
    HistoryStrip(),
    state.modalOpen ? AboutModal() : null,
  );
};

// ═══════════════════════════════════════════════════════════════════════
//  Mount + render loop (preserves input focus + caret across rerenders)
// ═══════════════════════════════════════════════════════════════════════

const root = document.getElementById("root");
let currentTree = null;

const rerender = () => {
  const active = document.activeElement;
  const id = active && active.id ? active.id : null;
  let start = null,
    end = null;
  if (id && typeof active.selectionStart === "number") {
    start = active.selectionStart;
    end = active.selectionEnd;
  }

  const next = App();
  if (currentTree) root.replaceChild(next, currentTree);
  else root.appendChild(next);
  currentTree = next;

  if (id) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) {
      el.focus();
      if (start != null && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(start, end);
        } catch {}
      }
    }
  }
};

// Esc closes the about modal.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.modalOpen) closeAbout();
});

// Delegated bit-flip on mousedown — not click. A quick tap finishes within
// one frame, so the native click event fires fine. A slower physical press
// (trackpad force-press, slow finger lift) leaves enough time for the
// rerender that mouseenter queued to fire between mousedown and mouseup.
// That destroys the original click target, and Chrome then doesn't fire a
// `click` event at all. mousedown fires synchronously the instant the
// press lands — well before any rAF can rebuild the DOM.
root.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const t = e.target.closest("[data-bit-idx]");
  if (!t) return;
  const idx = Number(t.dataset.bitIdx);
  if (Number.isFinite(idx)) setBytes(flipBit(state.bytes, idx));
});

// Wire the inline-HTML "about" link in the nav, plus support opening the
// modal via #about hash (so the RFC page can link to it).
const navAbout = document.getElementById("nav-about");
if (navAbout)
  navAbout.addEventListener("click", (e) => {
    e.preventDefault();
    openAbout();
  });
if (location.hash === "#about") {
  // Strip the hash so refresh doesn't re-trigger the modal once dismissed.
  history.replaceState(null, "", location.pathname + location.search);
  Promise.resolve().then(openAbout);
}

// URL deep-links from the spec page:
//   ?uuid=<value>   — parse and load this UUID
//   ?gen=v1|...|max — generate a fresh UUID of the requested kind
// Run before the initial history push so we don't pollute "recent" with a
// throwaway v7 the user never asked to see.
{
  const params = new URLSearchParams(location.search);
  const uParam = params.get("uuid");
  const gParam = params.get("gen");
  let asyncBytes = null;
  let initialOverride = null;
  if (uParam) {
    const b = parseUuid(uParam);
    if (b) initialOverride = b;
  }
  if (!initialOverride && gParam) {
    const fn = GENERATORS[gParam.toLowerCase()];
    if (fn) {
      const out = fn();
      if (out && typeof out.then === "function") asyncBytes = out;
      else initialOverride = out;
    }
  }
  if (initialOverride) state.bytes = initialOverride;
  if (uParam || gParam) history.replaceState(null, "", location.pathname);
  state = { ...state, history: pushRecent(state.history, state.bytes) };
  rerender();
  if (asyncBytes) asyncBytes.then((b) => setBytes(b));
}
