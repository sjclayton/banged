const $ = (id) => document.getElementById(id);
const ROW_LIMIT = 200;
let bangs = [];
let settings = { ...DEFAULT_SETTINGS };

function validUrl(u) {
  return /^https?:\/\//i.test(u) && u.includes("{{{s}}}");
}

function syncControls() {
  $("fallback").value = settings.fallbackBang;
  $("openIn").value = settings.openIn;
  $("bangKey").checked = settings.bangKey !== false;
  $("bangInFields").checked = settings.bangInFields !== false;
  $("icons").checked = settings.icons !== false;
  $("triggerKey").value = settings.triggerKey;
  $("popupShortcut").value = settings.popupShortcut;
  document.querySelectorAll(".trig").forEach((n) => (n.textContent = settings.triggerKey));
}

async function load() {
  const data = await browser.storage.local.get(["bangs", "settings"]);
  bangs = data.bangs || DEFAULT_BANGS;
  settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(data.settings) };
  syncControls();
  render();
}

async function persist() {
  await browser.storage.local.set({ bangs, settings });
  render();
}

function payload() {
  return { format: "bang-search-config", version: 2, settings, bangs };
}

function applyTheme() {
  const t = settings.theme || "system";
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll("#theme button").forEach((b) => b.classList.toggle("on", b.dataset.value === t));
}

function render() {
  applyTheme();
  const f = $("filter").value.trim().toLowerCase();
  const all = bangs
    .map((b, i) => ({ b, i }))
    .filter(
      ({ b }) =>
        !f ||
        bangTriggers(b).some((k) => k.toLowerCase().includes(f)) ||
        b.name.toLowerCase().includes(f) ||
        b.url.toLowerCase().includes(f)
    )
    .sort((a, c) => (c.b.favourite ? 1 : 0) - (a.b.favourite ? 1 : 0) || bangCollator.compare(a.b.bang, c.b.bang));
  $("count").textContent =
    all.length > ROW_LIMIT
      ? `Showing ${ROW_LIMIT} of ${all.length} bangs. Use the filter to find others.`
      : `${all.length} bangs`;
  const tbody = $("list");
  tbody.textContent = "";
  for (const { b, i } of all.slice(0, ROW_LIMIT)) {
    const tr = document.createElement("tr");

    const tdStar = document.createElement("td");
    const star = document.createElement("button");
    star.className = "star" + (b.favourite ? " on" : "");
    star.textContent = b.favourite ? "★" : "☆";
    star.onclick = () => {
      bangs[i].favourite = !bangs[i].favourite;
      persist();
    };
    tdStar.append(star);

    const tdBang = document.createElement("td");
    tdBang.textContent = bangTriggers(b).map((k) => "!" + k).join("  ");
    const tdName = document.createElement("td");
    tdName.textContent = b.name;
    const tdUrl = document.createElement("td");
    tdUrl.className = "url";
    tdUrl.textContent = b.url;
    tdUrl.title = b.url;

    const tdAct = document.createElement("td");
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.onclick = () => startEdit(i);
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger";
    del.onclick = () => {
      bangs.splice(i, 1);
      persist();
    };
    tdAct.append(edit, del);

    tr.append(tdStar, tdBang, tdName, tdUrl, tdAct);
    tbody.append(tr);
  }
}

function startEdit(i) {
  const b = bangs[i];
  $("editing").value = i;
  $("bang").value = b.bang;
  $("aliases").value = (b.aliases || []).join(", ");
  $("name").value = b.name;
  $("url").value = b.url;
  $("fav").checked = !!b.favourite;
  $("cancel").hidden = false;
  $("bang").focus();
  $("form").scrollIntoView({ block: "center" });
}

function resetForm() {
  $("form").reset();
  $("editing").value = "";
  $("cancel").hidden = true;
  $("error").textContent = "";
}

function parseAliases(text, primary) {
  const seen = new Set([primary.toLowerCase()]);
  const out = [];
  for (let a of text.split(/[,\s]+/)) {
    a = a.trim().replace(/^!/, "");
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out;
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const primary = $("bang").value.trim().replace(/^!/, "");
  const entry = {
    bang: primary,
    aliases: parseAliases($("aliases").value, primary),
    name: $("name").value.trim(),
    url: $("url").value.trim(),
    favourite: $("fav").checked
  };
  if (!validUrl(entry.url)) {
    $("error").textContent = "URL must start with http(s):// and contain {{{s}}}";
    return;
  }
  const editing = $("editing").value;
  const taken = new Map();
  bangs.forEach((b, i) => {
    if (String(i) === editing) return;
    for (const k of bangTriggers(b)) taken.set(k.toLowerCase(), b);
  });
  for (const k of bangTriggers(entry)) {
    if (taken.has(k.toLowerCase())) {
      $("error").textContent = `"!${k}" is already used by ${taken.get(k.toLowerCase()).name}`;
      return;
    }
  }
  if (editing !== "") bangs[Number(editing)] = entry;
  else bangs.push(entry);
  resetForm();
  persist();
});

$("cancel").onclick = resetForm;
$("filter").oninput = render;

document.querySelectorAll("#theme button").forEach((b) => {
  b.onclick = () => {
    settings.theme = b.dataset.value;
    persist();
  };
});

$("bangKey").onchange = () => {
  settings.bangKey = $("bangKey").checked;
  persist();
};

$("icons").onchange = () => {
  settings.icons = $("icons").checked;
  persist();
};

$("bangInFields").onchange = () => {
  settings.bangInFields = $("bangInFields").checked;
  persist();
};

function keyError(msg) {
  $("keyError").textContent = msg || "";
}

// Click the box, then press the key (combination) you want. Esc cancels.
function recorder(input, onKey) {
  input.addEventListener("focus", () => {
    input.classList.add("rec");
    input.dataset.prev = input.value;
    input.value = "Press a key…";
  });
  input.addEventListener("blur", () => {
    input.classList.remove("rec");
    if (input.value === "Press a key…") input.value = input.dataset.prev;
  });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return input.blur();
    if (["Shift", "Control", "Alt", "Meta", "AltGraph", "Dead", "Process"].includes(e.key)) return;
    await onKey(e);
  });
}

function keyFromCode(code) {
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit([0-9])$/))) return m[1];
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const map = { Comma: "Comma", Period: "Period", Space: "Space", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
  return map[code] || null;
}

async function applyShortcut(sc, quiet) {
  try {
    await browser.commands.update({ name: "open-bang", shortcut: sc });
    return true;
  } catch (err) {
    if (!quiet) keyError("Firefox refused that shortcut: " + err.message);
    return false;
  }
}

recorder($("triggerKey"), async (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) {
    if (!e.getModifierState("AltGraph")) return keyError("Press the key on its own, without Ctrl, Alt or Meta.");
  }
  if (!validTriggerKey(e.key)) {
    return keyError("Pick a symbol that is not a letter, number or space (for example ` \\ ; ~ or !).");
  }
  keyError("");
  settings.triggerKey = e.key;
  syncControls();
  $("triggerKey").blur();
  await persist();
});

$("triggerReset").onclick = () => {
  keyError("");
  settings.triggerKey = DEFAULT_SETTINGS.triggerKey;
  syncControls();
  persist();
};

recorder($("popupShortcut"), async (e) => {
  const key = keyFromCode(e.code);
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
  const sc = key && normalizeShortcut([...mods, key].join("+"));
  if (!sc) return keyError("Use Ctrl or Alt plus a letter, number, F1–F12, or one of: , . Space Home End PageUp PageDown Insert Delete arrows.");
  if (!(await applyShortcut(sc))) return;
  keyError("");
  settings.popupShortcut = sc;
  syncControls();
  $("popupShortcut").blur();
  await persist();
});

$("shortcutReset").onclick = async () => {
  keyError("");
  try {
    await browser.commands.reset("open-bang");
  } catch (err) {
    await applyShortcut(DEFAULT_SETTINGS.popupShortcut, true);
  }
  settings.popupShortcut = DEFAULT_SETTINGS.popupShortcut;
  syncControls();
  persist();
};

$("fallback").onchange = () => {
  settings.fallbackBang = $("fallback").value.trim().replace(/^!/, "");
  persist();
};

$("openIn").onchange = () => {
  settings.openIn = $("openIn").value;
  persist();
};

$("reset").onclick = () => {
  if (!confirm("Reset all bangs and settings to defaults?")) return;
  bangs = JSON.parse(JSON.stringify(DEFAULT_BANGS));
  settings = { ...DEFAULT_SETTINGS };
  syncControls();
  applyShortcut(DEFAULT_SETTINGS.popupShortcut, true);
  persist();
};

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export").onclick = () => downloadJson(payload(), "bang-search-config.json");

$("exportPolicy").onclick = () => {
  const add = [];
  for (const b of bangs) {
    let icon;
    try {
      icon = new URL(b.url.replace(/\{\{\{(s|raw)\}\}\}.*$/, "")).origin + "/favicon.ico";
    } catch (e) {
      icon = undefined;
    }
    for (const k of bangTriggers(b)) {
      const engine = {
        Name: `${b.name} (!${k})`,
        Description: `Bang search: !${k}`,
        Alias: "!" + k,
        Method: "GET",
        URLTemplate: b.url.replace(/\{\{\{(s|raw)\}\}\}/g, "{searchTerms}")
      };
      if (icon) engine.IconURL = icon;
      add.push(engine);
    }
  }
  downloadJson({ policies: { SearchEngines: { Add: add } } }, "policies.json");
};

function sanitize(incoming) {
  const seen = new Set();
  const out = [];
  for (const b of incoming) {
    if (!b || typeof b.bang !== "string" || typeof b.name !== "string" || typeof b.url !== "string" || !validUrl(b.url)) continue;
    const bang = b.bang.replace(/^!/, "").trim();
    if (!bang || /\s/.test(bang) || seen.has(bang.toLowerCase())) continue;
    seen.add(bang.toLowerCase());
    const aliases = [];
    if (Array.isArray(b.aliases)) {
      for (let a of b.aliases) {
        if (typeof a !== "string") continue;
        a = a.replace(/^!/, "").trim();
        if (!a || /\s/.test(a) || seen.has(a.toLowerCase())) continue;
        seen.add(a.toLowerCase());
        aliases.push(a);
      }
    }
    out.push({ bang, aliases, name: b.name, url: b.url, favourite: !!b.favourite });
  }
  return out;
}

async function importData(data, mode) {
  const incoming = Array.isArray(data) ? data : data.bangs;
  if (!Array.isArray(incoming)) throw new Error("No bangs found");
  const clean = sanitize(incoming);
  if (!clean.length) throw new Error("No valid bangs found");
  if (mode === "replace") {
    bangs = clean;
    if (data.settings && typeof data.settings === "object") {
      settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(data.settings) };
      syncControls();
      await applyShortcut(settings.popupShortcut, true);
    }
  } else {
    const owner = new Map();
    const live = new Set(bangs);
    for (const b of bangs) for (const k of bangTriggers(b)) owner.set(k.toLowerCase(), b);
    for (const b of clean) {
      for (const k of bangTriggers(b)) {
        const o = owner.get(k.toLowerCase());
        if (o && live.has(o)) live.delete(o);
      }
      live.add(b);
      for (const k of bangTriggers(b)) owner.set(k.toLowerCase(), b);
    }
    bangs = [...live];
  }
  await persist();
  return { n: clean.length, bangs: clean, settings: sanitizeSettings(data.settings) };
}

$("import").onclick = () => $("file").click();

$("file").onchange = async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  try {
    const { n, bangs: incoming, settings: incomingSettings } = await importData(JSON.parse(await file.text()), $("importMode").value);
    const saved = await autoSaveImport(file.name.replace(/\.json$/i, ""), incoming, incomingSettings);
    $("codeStatus").textContent = `Imported ${n} bangs from file.` + saved;
  } catch (err) {
    $("codeStatus").textContent = "Import failed: " + err.message;
  }
};

$("genCode").onclick = async () => {
  try {
    const code = await encodeShareCode(bangs, settings);
    $("codeOut").value = code;
    const len = code.replace(/-/g, "").length;
    $("codeStatus").textContent =
      len > 4000
        ? `Code is ${len} characters long. For big lists, sharing the exported file is easier.`
        : `Code is ${len} characters long.`;
  } catch (err) {
    $("codeStatus").textContent = "Could not create code: " + err.message;
  }
};

$("copyCode").onclick = async () => {
  const v = $("codeOut").value;
  if (!v) {
    $("codeStatus").textContent = "Generate a code first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(v);
    $("codeStatus").textContent = "Code copied.";
  } catch (e) {
    $("codeOut").select();
    $("codeStatus").textContent = "Select the code and copy it manually.";
  }
};

$("loadCode").onclick = async () => {
  const code = $("codeIn").value.trim();
  if (!code) return;
  try {
    const data = await decodeShareCode(code);
    const mode = $("importMode").value;
    if (mode === "replace" && !confirm("Replace your current bangs and settings with this code?")) return;
    const { n, bangs: incoming, settings: incomingSettings } = await importData(data, mode);
    const saved = await autoSaveImport("", incoming, incomingSettings);
    $("codeIn").value = "";
    $("codeStatus").textContent = `Loaded ${n} bangs.` + saved;
  } catch (err) {
    $("codeStatus").textContent = "Could not load code: " + err.message;
  }
};

// ---------------------------------------------------------------------------
// Saved configurations (stored locally as share codes)
// ---------------------------------------------------------------------------
let library = [];

function libStatus(msg) {
  $("libStatus").textContent = msg || "";
}

async function saveLibrary() {
  await browser.storage.local.set({ library });
  renderLibrary();
}

async function loadLibrary() {
  const d = await browser.storage.local.get("library");
  library = (Array.isArray(d.library) ? d.library : []).filter(
    (x) => x && typeof x.id === "string" && (typeof x.code === "string" || typeof x.file === "string")
  );
  // Built-in configurations are added once; deleting one keeps it deleted (until "Restore built-in").
  const seen = new Set(Array.isArray(d.builtinSeeded) ? d.builtinSeeded : []);
  let changed = false;
  for (const cfg of BUILTIN_CONFIGS) {
    if (seen.has(cfg.id)) continue;
    seen.add(cfg.id);
    changed = true;
    if (!library.some((x) => x.id === cfg.id)) library.push(builtinEntry(cfg));
  }
  if (changed) await browser.storage.local.set({ library, builtinSeeded: [...seen] });
  renderLibrary();
}

function builtinEntry(cfg) {
  return { id: cfg.id, name: cfg.name, file: cfg.file, count: cfg.count, saved: Date.now(), builtin: true };
}

async function addToLibrary(name, bangList, settingsObj) {
  const code = await encodeShareCode(bangList, { ...DEFAULT_SETTINGS, ...settingsObj });
  if (library.some((x) => x.code === code)) return false;
  library.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || "Saved " + new Date().toLocaleString(),
    code,
    count: bangList.length,
    saved: Date.now()
  });
  await saveLibrary();
  return true;
}

async function autoSaveImport(name, bangList, settingsObj) {
  if (!$("autoSave").checked) return "";
  try {
    const added = await addToLibrary(name || $("libName").value.trim() || "Imported " + new Date().toLocaleString(), bangList, settingsObj);
    if (added) $("libName").value = "";
    return added ? " Saved to your list." : " Already in your saved list.";
  } catch (err) {
    return " (Could not save to your list: " + err.message + ")";
  }
}

async function useEntry(entry, mode) {
  try {
    let data;
    if (entry.file) {
      libStatus("Loading…");
      const res = await fetch(browser.runtime.getURL(entry.file));
      data = await res.json();
    } else {
      data = await decodeShareCode(entry.code);
    }
    if (mode === "replace" && !confirm(`Replace your current bangs and settings with "${entry.name}"?`)) return;
    const { n } = await importData(data, mode);
    libStatus(mode === "replace" ? `Applied "${entry.name}" (${n} bangs).` : `Merged ${n} bangs from "${entry.name}".`);
  } catch (err) {
    libStatus("Could not load that configuration: " + err.message);
  }
}

function renderLibrary() {
  const ul = $("library");
  ul.textContent = "";
  if (!library.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing saved yet.";
    ul.append(li);
    return;
  }
  for (const entry of library) {
    const li = document.createElement("li");
    const name = document.createElement("input");
    name.type = "text";
    name.className = "libname";
    name.value = entry.name;
    name.title = "Click to rename";
    name.onchange = () => {
      entry.name = name.value.trim() || entry.name;
      saveLibrary();
    };
    const meta = document.createElement("span");
    meta.className = "libmeta";
    meta.textContent = entry.file
      ? `${entry.count} bangs · built in`
      : `${entry.count} bangs · ${new Date(entry.saved).toLocaleDateString()} · ${entry.code.length}-character code`;
    const mk = (label, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = fn;
      return b;
    };
    li.append(
      name,
      meta,
      mk("Apply", () => useEntry(entry, "replace")),
      mk("Merge", () => useEntry(entry, "merge")),
      ...(entry.file
        ? []
        : [
            mk("Copy code", async () => {
              try {
                await navigator.clipboard.writeText(entry.code);
                libStatus("Code copied.");
              } catch (e) {
                libStatus("Could not copy. Code: " + entry.code);
              }
            })
          ]),
      mk(
        "Delete",
        () => {
          library = library.filter((x) => x !== entry);
          saveLibrary();
        },
        "danger"
      )
    );
    ul.append(li);
  }
}

$("libRestore").onclick = async () => {
  const missing = BUILTIN_CONFIGS.filter((cfg) => !library.some((x) => x.id === cfg.id));
  for (const cfg of missing) library.push(builtinEntry(cfg));
  await browser.storage.local.set({ builtinSeeded: BUILTIN_CONFIGS.map((c) => c.id) });
  await saveLibrary();
  libStatus(missing.length ? "Built-in configurations restored." : "All built-in configurations are already in your list.");
};

$("libSave").onclick = async () => {
  try {
    const added = await addToLibrary($("libName").value.trim(), bangs, settings);
    if (added) $("libName").value = "";
    libStatus(added ? "Saved." : "That exact setup is already in your list.");
  } catch (err) {
    libStatus("Could not save: " + err.message);
  }
};

load();
loadLibrary();
