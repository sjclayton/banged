let bangs = [];
let settings = { ...DEFAULT_SETTINGS };
let prepared = [];
let byTrigger = new Map();

function rebuild() {
  prepared = prepareBangs(bangs);
  byTrigger = triggerMap(bangs);
}

async function load() {
  const data = await browser.storage.local.get(["bangs", "settings"]);
  if (!data.bangs) {
    await browser.storage.local.set({ bangs: DEFAULT_BANGS, settings: DEFAULT_SETTINGS });
    bangs = DEFAULT_BANGS;
  } else {
    bangs = data.bangs;
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  }
  rebuild();
  applyShortcut(settings.popupShortcut);
}

async function applyShortcut(sc) {
  const shortcut = normalizeShortcut(sc);
  // Leave the browser's own (possibly user-edited) shortcut alone unless this add-on's setting changed it.
  if (!shortcut || shortcut === DEFAULT_SETTINGS.popupShortcut) return;
  try {
    await browser.commands.update({ name: "open-bang", shortcut });
  } catch (e) {
    console.warn("Bang Search: could not set shortcut", e);
  }
}

browser.storage.onChanged.addListener((changes) => {
  if (changes.bangs) {
    bangs = changes.bangs.newValue || [];
    rebuild();
  }
  if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
});

load();

const ENGINE_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|startpage|qwant|yandex|ask|brave)\./i;
const ENGINE_PARAMS = ["q", "query", "p", "text", "search_query"];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildUrl(b, query) {
  return b.url.replace(/\{\{\{s\}\}\}/g, encodeURIComponent(query)).replace(/\{\{\{raw\}\}\}/g, query);
}

function targetFor(b, query) {
  if (query) return buildUrl(b, query);
  try {
    return new URL(b.url.replace(/\{\{\{(s|raw)\}\}\}.*$/, "")).origin;
  } catch (e) {
    return null;
  }
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    let u;
    try {
      u = new URL(details.url);
    } catch (e) {
      return;
    }
    if (!ENGINE_HOST.test(u.hostname)) return;
    for (const p of ENGINE_PARAMS) {
      const v = u.searchParams.get(p);
      if (!v || !v.trim().startsWith("!")) continue;
      const m = v.trim().match(/^!(\S+)(?:\s+([\s\S]*))?$/);
      if (!m) continue;
      const b = byTrigger.get(m[1].toLowerCase());
      if (!b) continue;
      const target = targetFor(b, (m[2] || "").trim());
      if (target) return { redirectUrl: target };
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

// ---- site icons: fetched here, cached in storage, handed to the UI as base64 ----
const FAVICON_MAX_BYTES = 64 * 1024;
const FAVICON_RETRY_MS = 7 * 24 * 3600 * 1000;
const FAVICON_MAX_ENTRIES = 400;
const faviconCache = new Map();
const faviconInflight = new Map();
const faviconReady = browser.storage.local.get("favicons").then((d) => {
  for (const [k, v] of Object.entries(d.favicons || {})) faviconCache.set(k, v);
});
let faviconSaveTimer = null;

function saveFavicons() {
  clearTimeout(faviconSaveTimer);
  faviconSaveTimer = setTimeout(() => {
    const entries = [...faviconCache.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, FAVICON_MAX_ENTRIES);
    browser.storage.local.set({ favicons: Object.fromEntries(entries) });
  }, 1500);
}

async function fetchIcon(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(url, { credentials: "omit", signal: ctl.signal });
    if (!r.ok) return null;
    const blob = await r.blob();
    const type = (blob.type || "").toLowerCase();
    if (!blob.size || blob.size > FAVICON_MAX_BYTES) return null;
    if (type && !type.startsWith("image/") && type !== "application/octet-stream") return null;
    if (type === "image/svg+xml") return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    return { m: type.startsWith("image/") ? type : "image/x-icon", d: String(dataUrl).split(",")[1] };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getFavicon(origin) {
  await faviconReady;
  let host;
  try {
    const u = new URL(origin);
    if (!/^https?:$/.test(u.protocol) || u.origin !== origin) return null;
    host = u.hostname;
  } catch (e) {
    return null;
  }
  const hit = faviconCache.get(origin);
  if (hit && (hit.d || Date.now() - hit.t < FAVICON_RETRY_MS)) return hit.d ? { mime: hit.m, b64: hit.d } : null;
  if (!faviconInflight.has(origin)) {
    faviconInflight.set(
      origin,
      (async () => {
        // The site's own icon first, then a public icon service as a fallback.
        const found =
          (await fetchIcon(origin + "/favicon.ico")) ||
          (await fetchIcon("https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(host)));
        faviconCache.set(origin, found ? { ...found, t: Date.now() } : { t: Date.now() });
        saveFavicons();
        faviconInflight.delete(origin);
        return found ? { mime: found.m, b64: found.d } : null;
      })()
    );
  }
  return faviconInflight.get(origin);
}

browser.runtime.onMessage.addListener(async (m, sender) => {
  if (!m) return;
  if (m.type === "favicon") {
    return getFavicon(String(m.origin || ""));
  } else if (m.type === "relay-toggle") {
    if (sender.tab) await browser.tabs.sendMessage(sender.tab.id, { type: "toggle" }, { frameId: 0 });
  } else if (m.type === "close-overlay") {
    if (m.tabId) await browser.tabs.update(m.tabId, { active: true }).catch(() => {});
    if (m.closeTabId) await browser.tabs.remove(m.closeTabId).catch(() => {});
  } else if (m.type === "options") {
    await browser.runtime.openOptionsPage();
    if (m.closeTabId) await browser.tabs.remove(m.closeTabId).catch(() => {});
  } else if (m.type === "open") {
    const wid = m.windowId ? { windowId: m.windowId } : {};
    if (m.mode === "tab") {
      await browser.tabs.create({ url: m.url, ...wid });
    } else if (m.mode === "background") {
      await browser.tabs.create({ url: m.url, active: false, ...wid });
    } else if (m.tabId) {
      await browser.tabs.update(m.tabId, { url: m.url, active: true });
    } else if (sender.tab) {
      await browser.tabs.update(sender.tab.id, { url: m.url });
    } else {
      const [t] = await browser.tabs.query({ active: true, currentWindow: true });
      if (t) await browser.tabs.update(t.id, { url: m.url });
      else await browser.tabs.create({ url: m.url });
    }
    if (m.closeTabId) await browser.tabs.remove(m.closeTabId).catch(() => {});
  }
});

browser.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "open-bang") return;
  try {
    const [t] = await browser.tabs.query({ active: true, currentWindow: true });
    await browser.tabs.sendMessage(t.id, { type: "toggle" }, { frameId: 0 });
  } catch (e) {
    // Pages the content script can't run on: open the same overlay in its own tab.
    try {
      const [t] = await browser.tabs.query({ active: true, currentWindow: true });
      const q = t ? "?win=" + t.windowId + "&tab=" + t.id : "";
      await browser.tabs.create({ url: browser.runtime.getURL("overlay.html") + q, windowId: t && t.windowId });
    } catch (err) {
      browser.browserAction.openPopup();
    }
  }
});

browser.omnibox.setDefaultSuggestion({
  description: "Type a site name (e.g. yt or youtube), then a space and your query"
});

browser.omnibox.onInputChanged.addListener((text, suggest) => {
  const input = text.replace(/^!/, "");
  const parsed = input.match(/^(\S+)\s+([\s\S]*)$/);
  if (parsed) {
    const b = byTrigger.get(parsed[1].toLowerCase());
    if (b) {
      suggest([
        {
          content: `${parsed[1]} ${parsed[2]}`,
          description: `${b.favourite ? "★ " : ""}Search ${esc(b.name)} for <match>${esc(parsed[2])}</match>`
        }
      ]);
      return;
    }
  }
  const typed = input.trim();
  if (!typed) {
    suggest(
      favouriteBangs(prepared, 8).map(({ b, via }) => ({
        content: `${via} `,
        description: `${b.favourite ? "★ " : ""}<match>!${esc(via)}</match> — ${esc(b.name)}`
      }))
    );
    return;
  }
  suggest(
    searchBangs(prepared, typed, 8).map(({ b, via }) => ({
      content: `${via} `,
      description: `${b.favourite ? "★ " : ""}<match>!${esc(via)}</match> — ${esc(b.name)}`
    }))
  );
});

browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const input = text.replace(/^!/, "").trim();
  const m = input.match(/^(\S+)\s+([\s\S]*)$/);
  const b = m && byTrigger.get(m[1].toLowerCase());
  let url;
  if (b) {
    url = targetFor(b, m[2].trim());
  } else {
    const only = byTrigger.get(input.toLowerCase());
    if (only) {
      url = targetFor(only, "");
    } else {
      const fb = byTrigger.get((settings.fallbackBang || "").toLowerCase()) || bangs[0];
      if (!fb) return;
      url = targetFor(fb, input);
    }
  }
  if (!url) return;
  if (settings.openIn === "tab") disposition = "newForegroundTab";
  else if (settings.openIn === "background") disposition = "newBackgroundTab";
  switch (disposition) {
    case "currentTab":
      browser.tabs.update({ url });
      break;
    case "newForegroundTab":
      browser.tabs.create({ url });
      break;
    case "newBackgroundTab":
      browser.tabs.create({ url, active: false });
      break;
  }
});
