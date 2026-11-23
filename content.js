let host = null;
let ui = null;
let opening = false;
let bangKeyEnabled = true;
let bangInFields = true;
let triggerKey = "!";

function mergeSettings(s) {
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(s) };
}

browser.storage.local.get("settings").then((d) => {
  bangKeyEnabled = mergeSettings(d.settings).bangKey !== false;
  bangInFields = mergeSettings(d.settings).bangInFields !== false;
  triggerKey = mergeSettings(d.settings).triggerKey;
});

browser.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    bangKeyEnabled = mergeSettings(changes.settings.newValue).bangKey !== false;
    bangInFields = mergeSettings(changes.settings.newValue).bangInFields !== false;
    triggerKey = mergeSettings(changes.settings.newValue).triggerKey;
  }
});

function isEmptyField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value === "";
  if (el.isContentEditable) return (el.textContent || "").trim() === "";
  return false;
}

function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !/^(button|checkbox|radio|submit|reset|image|file|range|color)$/i.test(el.type);
  if (el.isContentEditable) return true;
  const role = el.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

async function openBar() {
  if (host || opening) return;
  opening = true;
  try {
    if (window !== window.top) {
      browser.runtime.sendMessage({ type: "relay-toggle" });
      return;
    }
    const d = await browser.storage.local.get(["bangs", "settings"]);
    const bangs = d.bangs || DEFAULT_BANGS;
    const settings = mergeSettings(d.settings);
    host = document.createElement("div");
    host.style.cssText = "all:initial";
    const shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    ui = BangUI.create(shadow, {
      bangs,
      settings,
      overlay: true,
      onClose: closeBar,
      onSubmit: (url, mode) => {
        closeBar();
        browser.runtime.sendMessage({ type: "open", url, mode });
      },
      onOptions: () => {
        closeBar();
        browser.runtime.sendMessage({ type: "options" });
      }
    });
    ui.focus();
  } catch (err) {
    console.error("Bang Search: could not open the bar", err);
    closeBar();
  } finally {
    opening = false;
  }
}

function closeBar() {
  if (ui) ui.destroy();
  if (host) host.remove();
  ui = null;
  host = null;
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!bangKeyEnabled || host || opening) return;
    if (e.key !== triggerKey || e.isComposing) return;
    // Ctrl/Alt/Meta combos are shortcuts, except AltGr (reported as Ctrl+Alt) which types real characters.
    if ((e.ctrlKey || e.altKey || e.metaKey) && !e.getModifierState("AltGraph")) return;
    const target = e.composedPath()[0];
    if (isEditable(target) && !(bangInFields && isEmptyField(target))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openBar();
  },
  true
);

browser.runtime.onMessage.addListener((m) => {
  if (m && m.type === "toggle" && window === window.top) {
    if (host) closeBar();
    else openBar();
    return Promise.resolve(true);
  }
});
