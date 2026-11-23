(async () => {
  const d = await browser.storage.local.get(["bangs", "settings"]);
  const bangs = d.bangs || DEFAULT_BANGS;
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  const ui = BangUI.create(document.getElementById("root"), {
    bangs,
    settings,
    overlay: false,
    onClose: () => window.close(),
    onSubmit: (url, mode) => {
      browser.runtime.sendMessage({ type: "open", url, mode }).then(() => window.close());
    },
    onOptions: () => {
      browser.runtime.sendMessage({ type: "options" }).then(() => window.close());
    }
  });
  ui.focus();
})();
