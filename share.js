async function pipeBytes(transform, bytes) {
  const writer = transform.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(transform.readable).arrayBuffer());
}


// ---------------------------------------------------------------------------
// Compact share codes (format 1)
//
// Everything is bit-packed: built-in bangs are referenced by their position in
// DEFAULT_BANGS (append-only!), text is stored 7 bits per character with a
// dictionary of common URL fragments, and the result is written in base64url.
// The smaller of the raw and deflate-compressed forms is used. The last byte
// is a CRC-8 so a mistyped code is rejected.
// ---------------------------------------------------------------------------

// Fixed forever: the index is the code. Only ever append new entries (max 31).
const CODE_TOKENS = [
  null,
  "{{{s}}}", "https://www.", "https://", "http://", ".com/", ".com", ".org/", ".org", ".net/",
  "/search?q=", "/search?", "/search/", "/search", "?q=", "?search=", "search_query=", "?query=",
  "&q=", "?k=", "/results", "google", "wikipedia", "youtube", "github", "reddit",
  "/w/index.php", "?text=", "?s=", "/find?", "/?q=", "www."
];
const CODE_TOKEN_ORDER = CODE_TOKENS.map((t, i) => (t ? [t, i] : null)).filter(Boolean).sort((a, b) => b[0].length - a[0].length);

const CODE_THEMES = ["system", "light", "dark"];
const CODE_OPEN_IN = ["current", "tab", "background"];
const CODE_KEYS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1)),
  ...SHORTCUT_NAMED_KEYS
];

class BitWriter {
  constructor(aligned) {
    this.bits = [];
    this.aligned = !!aligned; // byte-aligned strings compress much better with deflate
  }
  align() {
    while (this.bits.length % 8) this.bits.push(0);
  }
  write(value, n) {
    for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2);
  }
  length() {
    return this.bits.length;
  }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) out[i >> 3] |= 128 >> (i & 7);
    });
    return out;
  }
}

class BitReader {
  constructor(bytes, aligned) {
    this.bytes = bytes;
    this.pos = 0;
    this.aligned = !!aligned;
  }
  align() {
    this.pos = Math.ceil(this.pos / 8) * 8;
  }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.bytes.length * 8) throw new Error("Code is incomplete or damaged");
      v = v * 2 + ((this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

function crc8(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 128 ? ((crc << 1) ^ 0x07) & 255 : (crc << 1) & 255;
  }
  return crc;
}

function bytesToB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error("Code contains an invalid character");
  let b = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function putLen(w, n) {
  if (n > 4000) throw new Error("A bang field is too long to put in a code");
  if (n < 31) w.write(n, 5);
  else {
    w.write(31, 5);
    w.write(n - 31, 12);
  }
}

function getLen(r) {
  const n = r.read(5);
  return n < 31 ? n : 31 + r.read(12);
}

function putStr(w, s) {
  s = String(s);
  if (w.aligned) {
    // [flag + 7-bit length] [optional 12-bit extra length] then 8-bit symbols, all on byte boundaries
    const ascii = /^[\x20-\x7e]*$/.test(s);
    const syms = [];
    if (ascii) {
      for (let i = 0; i < s.length; ) {
        const hit = CODE_TOKEN_ORDER.find(([t]) => s.startsWith(t, i));
        if (hit) {
          syms.push(hit[1]);
          i += hit[0].length;
        } else syms.push(s.charCodeAt(i++));
      }
    } else syms.push(...new TextEncoder().encode(s));
    if (syms.length > 4000) throw new Error("A bang field is too long to put in a code");
    w.align();
    w.write(ascii ? 0 : 1, 1);
    w.write(syms.length < 127 ? syms.length : 127, 7);
    if (syms.length >= 127) {
      w.write(syms.length - 127, 12);
      w.align();
    }
    for (const c of syms) w.write(c, 8);
    return;
  }
  if (/^[\x20-\x7e]*$/.test(s)) {
    const syms = [];
    for (let i = 0; i < s.length; ) {
      const hit = CODE_TOKEN_ORDER.find(([t]) => s.startsWith(t, i));
      if (hit) {
        syms.push(hit[1]);
        i += hit[0].length;
      } else syms.push(s.charCodeAt(i++));
    }
    w.write(0, 1);
    putLen(w, syms.length);
    for (const c of syms) w.write(c, 7);
  } else {
    const bytes = new TextEncoder().encode(s);
    w.write(1, 1);
    putLen(w, bytes.length);
    for (const c of bytes) w.write(c, 8);
  }
}

function getStr(r) {
  let utf8, n;
  if (r.aligned) {
    r.align();
    utf8 = r.read(1);
    n = r.read(7);
    if (n === 127) {
      n += r.read(12);
      r.align();
    }
    if (utf8) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = r.read(8);
      return new TextDecoder().decode(bytes);
    }
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = r.read(8);
      if (c >= 32 && c < 127) s += String.fromCharCode(c);
      else if (c < 32 && CODE_TOKENS[c]) s += CODE_TOKENS[c];
      else throw new Error("Code is incomplete or damaged");
    }
    return s;
  }
  utf8 = r.read(1);
  n = getLen(r);
  if (utf8) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = r.read(8);
    return new TextDecoder().decode(bytes);
  }
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = r.read(7);
    if (c >= 32) s += String.fromCharCode(c);
    else if (CODE_TOKENS[c]) s += CODE_TOKENS[c];
    else throw new Error("Code is incomplete or damaged");
  }
  return s;
}

function putVar(w, n) {
  // 4-bit groups; a group of 15 means "add more".
  while (n >= 15) {
    w.write(15, 4);
    n -= 15;
  }
  w.write(n, 4);
}

function getVar(r) {
  let n = 0;
  for (;;) {
    const g = r.read(4);
    n += g;
    if (g < 15) return n;
    if (n > 100000) throw new Error("Code is incomplete or damaged");
  }
}

function writeBody(w, bangs, settings) {
  const st = { ...DEFAULT_SETTINGS, ...settings };
  const dflt = DEFAULT_SETTINGS;
  // --- settings
  const sc = normalizeShortcut(st.popupShortcut) || dflt.popupShortcut;
  const custom =
    st.theme !== dflt.theme || st.openIn !== dflt.openIn || st.bangKey !== dflt.bangKey || st.bangInFields !== dflt.bangInFields ||
    st.icons !== dflt.icons || st.triggerKey !== dflt.triggerKey || sc !== dflt.popupShortcut || st.fallbackBang !== dflt.fallbackBang;
  w.write(custom ? 1 : 0, 1);
  if (custom) {
    w.write(Math.max(0, CODE_THEMES.indexOf(st.theme)), 2);
    w.write(Math.max(0, CODE_OPEN_IN.indexOf(st.openIn)), 2);
    w.write(st.bangKey === false ? 1 : 0, 1);
    w.write(st.bangInFields === false ? 1 : 0, 1);
    w.write(st.icons === false ? 1 : 0, 1);
    const t = st.triggerKey !== dflt.triggerKey && validTriggerKey(st.triggerKey);
    w.write(t ? 1 : 0, 1);
    if (t) w.write(st.triggerKey.codePointAt(0), 21);
    const s = sc !== dflt.popupShortcut;
    w.write(s ? 1 : 0, 1);
    if (s) {
      const parts = sc.split("+");
      const key = parts.pop();
      w.write(parts.includes("Ctrl") ? 1 : 0, 1);
      w.write(parts.includes("Alt") ? 1 : 0, 1);
      w.write(parts.includes("Shift") ? 1 : 0, 1);
      w.write(CODE_KEYS.indexOf(key), 6);
    }
    const f = st.fallbackBang !== dflt.fallbackBang;
    w.write(f ? 1 : 0, 1);
    if (f) putStr(w, st.fallbackBang);
  }
  // --- built-in bangs, by position: 0 absent, 1 present, 2 present + favourite, 3 present with own shortcuts
  const used = new Set();
  w.write(DEFAULT_BANGS.length, 6);
  for (const d of DEFAULT_BANGS) {
    const b = bangs.find((x) => !used.has(x) && x.bang === d.bang && x.name === d.name && x.url === d.url);
    if (!b) {
      w.write(0, 2);
      continue;
    }
    used.add(b);
    const al = Array.isArray(b.aliases) ? b.aliases : [];
    if (al.join(",") === (d.aliases || []).join(",")) w.write(b.favourite ? 2 : 1, 2);
    else {
      w.write(3, 2);
      w.write(b.favourite ? 1 : 0, 1);
      putVar(w, al.length);
      for (const a of al) putStr(w, a);
    }
  }
  // --- everything else
  const rest = bangs.filter((b) => !used.has(b));
  putVar(w, rest.length);
  for (const b of rest) {
    putStr(w, b.bang);
    const al = Array.isArray(b.aliases) ? b.aliases : [];
    putVar(w, al.length);
    for (const a of al) putStr(w, a);
    putStr(w, b.name);
    putStr(w, b.url);
    w.write(b.favourite ? 1 : 0, 1);
  }
}

function readBody(r) {
  const settings = {};
  if (r.read(1)) {
    settings.theme = CODE_THEMES[r.read(2)];
    settings.openIn = CODE_OPEN_IN[r.read(2)];
    settings.bangKey = !r.read(1);
    settings.bangInFields = !r.read(1);
    settings.icons = !r.read(1);
    if (r.read(1)) settings.triggerKey = String.fromCodePoint(r.read(21));
    if (r.read(1)) {
      const mods = [r.read(1) && "Ctrl", r.read(1) && "Alt", r.read(1) && "Shift"].filter(Boolean);
      settings.popupShortcut = [...mods, CODE_KEYS[r.read(6)]].join("+");
    }
    if (r.read(1)) settings.fallbackBang = getStr(r);
  }
  const bangs = [];
  const count = r.read(6);
  for (let i = 0; i < count; i++) {
    const state = r.read(2);
    if (!state) continue;
    const d = DEFAULT_BANGS[i];
    if (!d) throw new Error("This code needs a newer version of the extension");
    const b = { bang: d.bang, aliases: [...(d.aliases || [])], name: d.name, url: d.url, favourite: state === 2 };
    if (state === 3) {
      b.favourite = !!r.read(1);
      b.aliases = [];
      for (let n = getVar(r); n > 0; n--) b.aliases.push(getStr(r));
    }
    bangs.push(b);
  }
  for (let n = getVar(r); n > 0; n--) {
    const bang = getStr(r);
    const aliases = [];
    for (let k = getVar(r); k > 0; k--) aliases.push(getStr(r));
    const name = getStr(r);
    const url = getStr(r);
    bangs.push({ bang, aliases, name, url, favourite: !!r.read(1) });
  }
  return { bangs, settings: sanitizeSettings(settings) };
}

async function encodeShareCode(bangs, settings) {
  // Raw form: 3 header bits (version 1, not compressed) followed by the tightly packed body.
  const raw = new BitWriter();
  raw.write(1, 2);
  raw.write(0, 1);
  writeBody(raw, bangs, settings || {});
  let data = raw.toBytes();

  if (typeof CompressionStream !== "undefined") {
    const body = new BitWriter(true);
    writeBody(body, bangs, settings || {});
    const packed = await pipeBytes(new CompressionStream("deflate-raw"), body.toBytes());
    if (packed.length + 1 < data.length) {
      data = new Uint8Array(packed.length + 1);
      data[0] = 0b01100000;
      data.set(packed, 1);
    }
  }
  const out = new Uint8Array(data.length + 1);
  out.set(data);
  out[data.length] = crc8(data);
  return bytesToB64url(out);
}

async function decodeCompactCode(code) {
  const bytes = b64urlToBytes(code);
  if (bytes.length < 3) throw new Error("Code is too short");
  const data = bytes.subarray(0, bytes.length - 1);
  if (crc8(data) !== bytes[bytes.length - 1]) throw new Error("Code looks mistyped (checksum failed)");
  const head = new BitReader(data);
  if (head.read(2) !== 1) throw new Error("Unrecognized code");
  if (head.read(1)) {
    if (typeof DecompressionStream === "undefined") throw new Error("This Firefox cannot read compressed codes");
    const body = await pipeBytes(new DecompressionStream("deflate-raw"), data.slice(1));
    return readBody(new BitReader(body, true));
  }
  return readBody(head);
}

async function decodeShareCode(code) {
  const clean = String(code).replace(/\s+/g, "");
  if (!clean) throw new Error("Code is empty");
  if (/^([0-9A-Z]{5}-)+[0-9A-Z]{1,5}$/.test(clean)) {
    throw new Error("This is an old-style code, which is no longer supported");
  }
  return decodeCompactCode(clean);
}
