# Field-layout schema

A layout is a flat array of **field entries** that partitions the 128 bits of a UUID into contiguous, inclusive ranges. Each entry is self-describing: it carries its bit range, a `type` that tells the renderer how to decode the bits, a `tint` for the palette, an RFC `specSection` deep-link, and prose for the linear-walk view. Built-in layouts for v1–v8, nil, max, and `unknown` live in `FIELDS` inside `app.js`; custom layouts can be supplied externally and will render the same way (the upload UI is a planned addition — the schema is already stable).

Bit indices are inclusive and 0..127, MSB-first across the 16-byte UUID (bit 0 is the top bit of byte 0).

## Quick example

A real entry from the v7 layout:

```js
{
  start: 0,
  end: 47,
  key: "ts",
  label: "unix_ts_ms",
  type: "timestamp-unix-ms",
  tint: "timestamp",
  specSection: "5.7",
  description: "Unix milliseconds since epoch — gives v7 its time-ordering. 48 bits ≈ until year 10889."
}
```

- `start` / `end` — inclusive bit range (0..127). Here, the 48 leading bits.
- `key` — unique identifier within the layout, used for hover and focus.
- `label` — short text shown on chips and in the bit grid.
- `type` — decoder switch; `timestamp-unix-ms` formats the value as an ISO date plus a relative offset.
- `tint` — palette name resolved through `TINT_CSS` to a CSS variable.
- `specSection` — RFC 9562 section for the deep-link icon.
- `description` — the prose paragraph in the linear-walk view.

## Field entry reference

| Property      | Required | Type / valid values                                                          | What it controls |
| ------------- | -------- | ---------------------------------------------------------------------------- | ---------------- |
| `start`       | yes      | integer 0..127                                                               | First bit of the range (inclusive, MSB-first). |
| `end`         | yes      | integer `start`..127                                                         | Last bit of the range (inclusive). |
| `key`         | yes      | string, unique per layout                                                    | Stable identifier for hover, focus, and "jump to linear walk". |
| `type`        | yes      | one of the type names below                                                  | Dispatch in `decodedFor` — picks the decoder. |
| `label`       | optional | short string                                                                 | Text on the field chip and bit-grid tooltips. Defaults to `key`. |
| `description` | optional | string                                                                       | Paragraph shown in the linear walk. Omit to skip the prose row. |
| `tint`        | optional | one of the names in `TINT_CSS`                                               | Palette color. Unknown or missing values fall back to `rand-b`. |
| `specSection` | optional | RFC 9562 section string like `"5.7"` or `"4.1"`                              | Renders the `§N.N ↗` deep-link to the local `rfc9562.html`. |
| `value`       | depends  | for `version`: integer 0..15; for `variant`: `"rfc"`; for `static`: hex string or integer | The declared/expected value. `static` requires it; `version` and `variant` use it as documentation. |
| `values`      | depends  | object `{ [intKey]: humanLabel }`                                            | Required for `enum`; maps the integer value to a display string. |
| `group`       | optional | string                                                                       | Marks this entry as one slice of a multi-region field; siblings share the same key. |
| `groupOrder`  | optional | integer                                                                      | Position within the group, MSB-first; smaller `groupOrder` carries higher-order bits. |

## Field types

The supported `type` values are exactly the cases handled by `decodedFor`. Anything outside this list falls through to the hex-slice default.

### `timestamp-unix-ms`

Unsigned big-endian milliseconds since the Unix epoch. Decoded as an ISO timestamp plus a relative-time aux line. Used by v7 for its leading 48 bits.

```js
{ start: 0, end: 47, key: "ts", label: "unix_ts_ms", type: "timestamp-unix-ms",
  tint: "timestamp", specSection: "5.7",
  description: "Unix milliseconds since epoch — gives v7 its time-ordering. 48 bits ≈ until year 10889." }
```

### `gregorian-ticks`

100-nanosecond ticks since 1582-10-15 UTC (Gregorian epoch). When the entry has a `group`, the renderer combines all siblings before formatting as a date; an ungrouped `gregorian-ticks` slice just renders as a hex window. v1 splits the timestamp across three regions — see "Multi-region fields" below.

```js
{ start: 0, end: 31, key: "time_low", label: "time_low", type: "gregorian-ticks",
  group: "v1ts", groupOrder: 2,
  tint: "timestamp", specSection: "5.1",
  description: "Low 32 bits of the v1 100-ns Gregorian timestamp." }
```

### `version`

The 4-bit version nibble at bits 48..51. Decoded as `0xN (vN)`. `value` documents the version this layout asserts.

```js
{ start: 48, end: 51, key: "ver", label: "ver = 7", type: "version", value: 7,
  tint: "version", specSection: "4.2",
  description: "Fixed: marks this as version 7 (Unix-epoch time-ordered)." }
```

### `variant`

The 2-bit variant at bits 64..65. Decoded as the parsed variant name (e.g. `RFC variant`). Set `value: "rfc"` for the standard `10` variant.

```js
{ start: 64, end: 65, key: "var", label: "var = 10", type: "variant", value: "rfc",
  tint: "variant", specSection: "4.1",
  description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10." }
```

### `enum`

Small integer code with a human label per value. `values` is required and is keyed by integer (string keys parse as integers via `Number(...)`).

```js
{ start: 72, end: 79, key: "domain", label: "domain", type: "enum",
  values: { 0: "person (UID)", 1: "group (GID)", 2: "org" },
  tint: "rand-a", specSection: "5.2",
  description: "v2 local domain — POSIX UID/GID/organization context." }
```

### `node-id`

Decoded as zero-padded hex plus the unsigned integer in parentheses. Same renderer as `integer-hex`; the distinct name carries semantic intent.

```js
{ start: 80, end: 127, key: "node", label: "node (MAC)", type: "node-id",
  tint: "node", specSection: "5.1",
  description: "Node identifier — historically a 48-bit MAC address. RFC recommends a random value with the multicast bit set." }
```

### `integer-hex`

Like `node-id`: `0x<hex> (<decimal>)`. Use when the bits are a number you want to read in both bases.

```js
{ start: 66, end: 79, key: "clock_seq", label: "clock_seq", type: "integer-hex",
  tint: "rand-a", specSection: "5.6",
  description: "Clock sequence — guards against clock rewinds." }
```

### `integer`

Plain decimal. No hex form. Useful for sequence numbers and small counters that don't need the hex view.

### `counter`

A monotonic counter, group-aware. The decoded line shows decimal, hex, and the combined bit width. The Method-1 24-bit v7 counter spans the variant boundary, so `counter` entries set `group` and `groupOrder` — see "Multi-region fields".

```js
{ start: 52, end: 63, key: "counterHi", label: "counter (hi)",
  type: "counter", group: "v7counter", groupOrder: 0,
  tint: "rand-a", specSection: "6.2",
  description: "Method 1: high 12 bits of a 24-bit fixed-length counter. Increments on same-ms collisions; reseeds (23 bits) on a new ms." }
```

### `subms-tick`

Sub-millisecond timer fraction. Renders as `<n>/<2^width> (~<µs> µs into the ms)`. Used by v7 Method 3.

```js
{ start: 52, end: 59, key: "subms", label: "sub-ms", type: "subms-tick",
  tint: "rand-a", specSection: "6.2",
  description: "Method 3: 8-bit sub-millisecond tick (~3.9 µs per step) derived from the high-resolution timer. Replaces the top 8 bits of rand_a." }
```

### `static`

Bits whose value is known up front — namespace prefixes in custom v8 layouts, magic constants, or the whole-UUID nil/max markers. The `value` property carries the declared bit pattern (a hex string, with or without a `0x` prefix, or an integer; the renderer width-pads it to the field range). At decode time the actual bits are compared against `value`; on a match, the linear walk shows `label` plus a `↳ static value 0x… ✓` confirmation; on a mismatch, it shows the actual hex and flags `⚠ declared 0x… — does not match`. Omit `value` to render plain hex (then `static` behaves like `opaque` but still signals "fixed slot").

```js
{ start: 0, end: 127, key: "nil", label: "all zeros", type: "static",
  value: "00000000000000000000000000000000",
  tint: "rand-b", specSection: "5.9",
  description: "The nil UUID — all 128 bits zero. Reserved as a sentinel for 'no UUID'." }
```

```js
// Namespace prefix in a custom v8 layout — first 32 bits are always 0xDEADBEEF.
{ start: 0, end: 31, key: "ns", label: "namespace", type: "static",
  value: "deadbeef",
  tint: "timestamp",
  description: "Application namespace marker." }
```

### `hash`

Bits sourced from a hash digest (v3/v5). Decoded as the hex slice. The `description` is the place to say which digest produced the bits.

```js
{ start: 0, end: 47, key: "hashA", label: "sha1", type: "hash",
  tint: "rand-b", specSection: "5.5",
  description: "SHA-1(namespace ‖ name) — bits 0–47 of the hash. Deterministic, not random." }
```

### `random`

Bits that are random by construction. Decoded as the hex slice.

```js
{ start: 0, end: 47, key: "r1", label: "random", type: "random",
  tint: "rand-b", specSection: "5.4",
  description: "Random bits." }
```

### `opaque`

Catch-all for application-defined bits (v8 custom regions, unknown layouts, v1 clock fragments). Decoded as the hex slice.

```js
{ start: 0, end: 47, key: "custA", label: "custom_a", type: "opaque",
  tint: "timestamp", specSection: "5.8",
  description: "custom_a — implementation defined. Use any 48 bits of data your application needs." }
```

## Tints

`TINT_CSS` defines the palette:

- `timestamp`
- `version`
- `variant`
- `rand-a`
- `rand-b`
- `node`

Each name resolves to a CSS variable (e.g. `var(--field-ts)`). Unknown names fall back to `rand-b`. Adding a new tint requires both a key in `TINT_CSS` and a matching `--field-*` custom property in `studio.css`.

## Multi-region fields (groups)

Some logical fields don't sit in one contiguous range — most notably the v1 Gregorian timestamp (split into `time_low`, `time_mid`, `time_hi` around the version nibble) and the v7 Method-1 24-bit counter (split across the variant boundary). To model these, every entry in the logical field gets the same `group` string and a distinct `groupOrder`. `combineGroup` then stitches them MSB-first in ascending `groupOrder` and any group-aware decoder (`counter`, grouped `gregorian-ticks`) runs on the combined integer.

The v1 timestamp, verbatim from `FIELDS.v1`:

```js
{ start: 0,  end: 31, key: "time_low", label: "time_low", type: "gregorian-ticks",
  group: "v1ts", groupOrder: 2,
  tint: "timestamp", specSection: "5.1",
  description: "Low 32 bits of the v1 100-ns Gregorian timestamp." },
{ start: 32, end: 47, key: "time_mid", label: "time_mid", type: "gregorian-ticks",
  group: "v1ts", groupOrder: 1,
  tint: "timestamp", specSection: "5.1",
  description: "Mid 16 bits of the v1 100-ns Gregorian timestamp." },
// ver nibble at 48–51 lives between time_mid and time_hi
{ start: 52, end: 63, key: "time_hi", label: "time_hi", type: "gregorian-ticks",
  group: "v1ts", groupOrder: 0,
  tint: "timestamp", specSection: "5.1",
  description: "High 12 bits of the v1 100-ns Gregorian timestamp." }
```

`groupOrder: 0` is `time_hi` (most significant), then `time_mid`, then `time_low` — that's the order the bits are concatenated before being interpreted as 100-ns Gregorian ticks.

The v7 counter follows the same pattern, splitting a 24-bit value across the variant bits at 64..65:

```js
{ start: 52, end: 63, key: "counterHi", label: "counter (hi)",
  type: "counter", group: "v7counter", groupOrder: 0, ... },
{ start: 66, end: 77, key: "counterLo", label: "counter (lo)",
  type: "counter", group: "v7counter", groupOrder: 1, ... }
```

## A complete custom layout

A plausible application-defined v8 layout: 48-bit ms timestamp, 16-bit shard, version=8, 12-bit per-ms sequence, the RFC variant, and 46 random bits.

```js
[
  { start: 0,  end: 47,  key: "ts", label: "unix_ts_ms", type: "timestamp-unix-ms",
    tint: "timestamp", specSection: "5.8",
    description: "Unix milliseconds since epoch." },
  { start: 48, end: 51,  key: "ver", label: "ver = 8", type: "version", expected: 8,
    tint: "version", specSection: "4.2",
    description: "Fixed: marks this as version 8 (vendor/experimental)." },
  { start: 52, end: 63,  key: "seq", label: "sequence", type: "counter",
    tint: "rand-a", specSection: "5.8",
    description: "Per-millisecond sequence counter (12 bits). Increments on same-ms collisions." },
  { start: 64, end: 65,  key: "var", label: "var = 10", type: "variant", expected: "rfc",
    tint: "variant", specSection: "4.1",
    description: "Fixed: RFC 4122/9562 variant. Bits 64–65 = 10." },
  { start: 66, end: 81,  key: "shard", label: "shard", type: "integer-hex",
    tint: "node", specSection: "5.8",
    description: "16-bit shard id identifying the issuing partition." },
  { start: 82, end: 127, key: "rand", label: "random", type: "random",
    tint: "rand-b", specSection: "5.8",
    description: "46 random bits — collision resistance within a shard within a ms." }
]
```

Walk-through:

1. `ts` (0..47) — Unix ms timestamp, formatted as an ISO date.
2. `ver` (48..51) — fixed `0x8` so the bit pattern is recognized as v8.
3. `seq` (52..63) — `counter` type renders decimal/hex/width even without a `group` (single-region 12-bit counter).
4. `var` (64..65) — fixed `10` RFC variant.
5. `shard` (66..81) — `integer-hex` shows both `0x...` and the decimal id.
6. `rand` (82..127) — random tail; renders as a hex slice.

Every entry covers a contiguous range, the ranges are disjoint, together they span 0..127, and the version/variant slots sit at the canonical offsets.

## Validation and gotchas

- Bit ranges are inclusive 0..127, MSB-first. Adjacent entries must touch but not overlap; the whole layout must cover every bit.
- The version nibble must sit at bits 48..51 with `type: "version"`. The variant must sit at bits 64..65 with `type: "variant"`. The renderer assumes both positions when describing the UUID.
- `key` must be unique within a layout — hover, focus, and "jump to linear walk" all reference it.
- `label`, `description`, and `tint` are optional. `label` falls back to `key`, `description` is simply omitted when missing, and `tint` falls back to `rand-b`.
- `group` siblings must share the exact same `group` string and have distinct `groupOrder` values. Siblings are stitched in ascending `groupOrder` (smallest carries the most-significant bits).
- Adding a new tint requires both a key in `TINT_CSS` and a matching `--field-*` CSS variable in `studio.css`.
- `enum.values` keys are coerced to integers; use integer-valued keys (`0`, `1`, `2`), not arbitrary strings.
- `value` on `version` / `variant` is documentation; the layout still renders if the bits don't match. RFC compliance is reported separately by the validator.
- `value` on `static` is hex (string, with or without `0x`) or an integer. The renderer pads to the field width and surfaces mismatches with a ⚠ in the decoded row.
- For `gregorian-ticks`, omit `group` if you want a hex view; add a `group` to opt into the combined date decode.
