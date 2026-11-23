const DEFAULT_BANGS = [
  { bang: "yt", aliases: ["youtube", "ytb"], name: "YouTube", url: "https://www.youtube.com/results?search_query={{{s}}}", favourite: true },
  { bang: "g", aliases: ["google"], name: "Google", url: "https://www.google.com/search?q={{{s}}}", favourite: true },
  { bang: "w", aliases: ["wiki", "wikipedia"], name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search={{{s}}}", favourite: false },
  { bang: "gh", aliases: ["github"], name: "GitHub", url: "https://github.com/search?q={{{s}}}", favourite: false },
  { bang: "so", aliases: ["stackoverflow"], name: "Stack Overflow", url: "https://stackoverflow.com/search?q={{{s}}}", favourite: false },
  { bang: "r", aliases: ["reddit"], name: "Reddit", url: "https://www.reddit.com/search/?q={{{s}}}", favourite: false },
  { bang: "a", aliases: ["amazon", "amz"], name: "Amazon", url: "https://www.amazon.com/s?k={{{s}}}", favourite: false },
  { bang: "ddg", aliases: ["duckduckgo"], name: "DuckDuckGo", url: "https://duckduckgo.com/?q={{{s}}}", favourite: false },
  { bang: "gm", aliases: ["maps"], name: "Google Maps", url: "https://www.google.com/maps/search/{{{s}}}", favourite: false },
  { bang: "imdb", aliases: [], name: "IMDb", url: "https://www.imdb.com/find?q={{{s}}}", favourite: false },
  { bang: "mdn", aliases: [], name: "MDN", url: "https://developer.mozilla.org/en-US/search?q={{{s}}}", favourite: false },
  { bang: "tw", aliases: ["x", "twitter"], name: "X / Twitter", url: "https://x.com/search?q={{{s}}}", favourite: false },
  { bang: "sp", aliases: ["spotify"], name: "Spotify", url: "https://open.spotify.com/search/{{{s}}}", favourite: false },
  { bang: "wa", aliases: ["wolfram"], name: "Wolfram Alpha", url: "https://www.wolframalpha.com/input?i={{{s}}}", favourite: false }
];

const DEFAULT_SETTINGS = {
  fallbackBang: "g",
  openIn: "current",
  theme: "system",
  bangKey: true,
  bangInFields: true,
  icons: true,
  triggerKey: "!",
  popupShortcut: "Alt+1"
};

// A trigger key is one printable character that is not a letter, digit or space.
function validTriggerKey(k) {
  return typeof k === "string" && [...k].length === 1 && !/[\p{L}\p{N}\s\p{C}]/u.test(k);
}

const SHORTCUT_NAMED_KEYS = ["Comma", "Period", "Home", "End", "PageUp", "PageDown", "Space", "Insert", "Delete", "Up", "Down", "Left", "Right"];

// Returns the shortcut in Firefox's canonical form (e.g. "Ctrl+Alt+Shift+K"), or null if unusable.
function normalizeShortcut(s) {
  if (typeof s !== "string") return null;
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  let key = parts.pop();
  const mods = new Set();
  for (const m of parts) {
    const l = m.toLowerCase();
    if (l === "ctrl" || l === "control") mods.add("Ctrl");
    else if (l === "alt") mods.add("Alt");
    else if (l === "shift") mods.add("Shift");
    else return null;
  }
  if (!mods.has("Ctrl") && !mods.has("Alt")) return null;
  if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase();
  else if (/^f([1-9]|1[0-2])$/i.test(key)) key = key.toUpperCase();
  else {
    const named = SHORTCUT_NAMED_KEYS.find((n) => n.toLowerCase() === key.toLowerCase());
    if (!named) return null;
    key = named;
  }
  return ["Ctrl", "Alt", "Shift"].filter((m) => mods.has(m)).concat(key).join("+");
}

// Keeps only known settings with valid values, so codes and files from others can't break anything.
function sanitizeSettings(s) {
  const out = {};
  if (!s || typeof s !== "object") return out;
  if (typeof s.fallbackBang === "string") out.fallbackBang = s.fallbackBang.replace(/^!/, "").trim().slice(0, 64);
  if (["current", "tab", "background"].includes(s.openIn)) out.openIn = s.openIn;
  if (["system", "light", "dark"].includes(s.theme)) out.theme = s.theme;
  if (typeof s.bangKey === "boolean") out.bangKey = s.bangKey;
  if (typeof s.bangInFields === "boolean") out.bangInFields = s.bangInFields;
  if (typeof s.icons === "boolean") out.icons = s.icons;
  if (validTriggerKey(s.triggerKey)) out.triggerKey = s.triggerKey;
  const sc = normalizeShortcut(s.popupShortcut);
  if (sc) out.popupShortcut = sc;
  return out;
}
