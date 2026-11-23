// Full-tab version of the overlay, used on pages where content scripts can't run.
(async () => {
  const d = await browser.storage.local.get(["bangs", "settings"]);
  const bangs = d.bangs || DEFAULT_BANGS;
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  if (settings.theme === "light" || settings.theme === "dark") document.documentElement.dataset.theme = settings.theme;
  const params = new URLSearchParams(location.search);
  const windowId = parseInt(params.get("win"), 10) || undefined;
  const tabId = parseInt(params.get("tab"), 10) || undefined;
  const me = await browser.tabs.getCurrent();
  const closeTabId = me && me.id;
  const ui = BangUI.create(document.getElementById("root"), {
    bangs,
    settings,
    overlay: true,
    onClose: () => browser.runtime.sendMessage({ type: "close-overlay", tabId, closeTabId }),
    onSubmit: (url, mode) => browser.runtime.sendMessage({ type: "open", url, mode, windowId, tabId, closeTabId }),
    onOptions: () => browser.runtime.sendMessage({ type: "options", closeTabId })
  });
  ui.focus();
  window.addEventListener("focus", () => ui.focus());
})();
