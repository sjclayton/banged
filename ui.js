const BangUI = (() => {
  const DARK = "--bg:#1e1f2b;--bg2:#282a3a;--text:#f1f2f8;--muted:#9a9db4;--border:#363951;--accent:#8c96ff;--accent-bg:rgba(140,150,255,.16);--shadow:0 24px 70px rgba(0,0,0,.6);";

  const CSS = `
.bs-root,.bs-root *{box-sizing:border-box}
.bs-root{--bg:#ffffff;--bg2:#f2f3f8;--text:#16161d;--muted:#6b6e80;--border:#e3e5ee;--accent:#5865f2;--accent-bg:rgba(88,101,242,.12);--shadow:0 24px 70px rgba(15,15,40,.35);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text)}
@media (prefers-color-scheme:dark){.bs-root:not([data-theme="light"]){${DARK}}}
.bs-root[data-theme="dark"]{${DARK}}
.bs-root [hidden]{display:none!important}
.bs-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;background:rgba(8,8,20,.45)}
.bs-panel{width:min(620px,92vw);background:var(--bg);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
.bs-popup .bs-panel{width:440px;border:0;border-radius:0;box-shadow:none}
.bs-bar{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)}
.bs-glyph{font-weight:700;font-size:20px;color:var(--accent);width:16px;text-align:center}
.bs-chip{flex:none;background:var(--accent-bg);color:var(--accent);padding:4px 10px;border-radius:999px;font-weight:600;white-space:nowrap}
.bs-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:18px;padding:2px 0;box-shadow:none}
.bs-input::placeholder{color:var(--muted)}
.bs-gear{border:0;background:transparent;color:var(--muted);font-size:18px;line-height:1;cursor:pointer;border-radius:8px;padding:6px 8px}
.bs-gear:hover{background:var(--bg2);color:var(--text)}
.bs-list{list-style:none;margin:0;padding:6px;max-height:340px;overflow:auto}
.bs-item{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;cursor:pointer}
.bs-item.sel{background:var(--accent-bg)}
.bs-icon{flex:none;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
.bs-icon.fav{border-radius:8px;background:var(--bg2)}
.bs-text{flex:1;min-width:0}
.bs-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bs-sub{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bs-star{color:#f5a623}
.bs-tag{font-family:ui-monospace,Menlo,Consolas,monospace;background:var(--bg2);color:var(--muted);padding:2px 8px;border-radius:6px;font-size:12px}
.bs-item.sel .bs-tag{color:var(--accent)}
.bs-empty{padding:18px;color:var(--muted);text-align:center}
.bs-foot{padding:8px 16px;border-top:1px solid var(--border);background:var(--bg2);color:var(--muted);font-size:12px}
`;

  const RESULT_LIMIT = 8;

  function targetUrl(b, q) {
    if (!q) {
      try {
        return new URL(b.url.replace(/\{\{\{(s|raw)\}\}\}.*$/, "")).origin;
      } catch (e) {
        return b.url;
      }
    }
    return b.url.replace(/\{\{\{s\}\}\}/g, encodeURIComponent(q)).replace(/\{\{\{raw\}\}\}/g, q);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function create(container, opts) {
    const bangs = opts.bangs;
    const settings = opts.settings;
    const prepared = prepareBangs(bangs);
    const style = document.createElement("style");
    style.textContent = CSS;

    const root = el("div", "bs-root " + (opts.overlay ? "bs-overlay" : "bs-popup"));
    if (settings.theme === "light" || settings.theme === "dark") root.dataset.theme = settings.theme;

    const panel = el("div", "bs-panel");
    const bar = el("div", "bs-bar");
    const glyph = el("span", "bs-glyph", "!");
    const chip = el("span", "bs-chip");
    chip.hidden = true;
    const input = el("input", "bs-input");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = "Type a site, e.g. yt or youtube";
    const gear = el("button", "bs-gear", "⚙");
    gear.type = "button";
    gear.title = "Settings";
    bar.append(glyph, chip, input, gear);
    const list = el("ul", "bs-list");
    list.hidden = true;
    const foot = el("div", "bs-foot");
    panel.append(bar, list, foot);
    root.append(panel);
    container.append(style, root);

    let mode = "pick";
    let sel = 0;
    let results = [];
    let current = null;
    let currentVia = "";

    const fallback = () =>
      bangs.find((b) => bangTriggers(b).some((k) => k === settings.fallbackBang)) || bangs[0];

    function badge(b) {
      const n = el("span", "bs-icon", (b.name || b.bang).charAt(0).toUpperCase());
      let h = 0;
      for (const c of b.bang) h = (h * 31 + c.charCodeAt(0)) % 360;
      n.style.background = `hsl(${h} 58% 46%)`;
      // The coloured letter stays until the site's real icon is available.
      const origin = settings.icons !== false ? bangOrigin(b) : null;
      if (origin) {
        faviconElement(origin, 20).then((icon) => {
          if (!icon) return;
          n.textContent = "";
          n.style.background = "";
          n.classList.add("fav");
          n.append(icon);
        });
      }
      return n;
    }

    function setFoot() {
      if (mode === "query") foot.textContent = "Enter to search  ·  Ctrl+Enter new tab  ·  Backspace to change site";
      else if (input.value.trim()) foot.textContent = "↑↓ move  ·  Enter to pick  ·  Esc to close";
      else foot.textContent = "Your favourites ★ are shown first  ·  Type to filter  ·  Esc to close";
    }

    function markSel() {
      [...list.children].forEach((n, i) => {
        n.classList.toggle("sel", i === sel);
        if (i === sel) n.scrollIntoView({ block: "nearest" });
      });
    }

    function renderList() {
      list.textContent = "";
      const t = input.value.trim();
      results = mode !== "pick" ? [] : t ? searchBangs(prepared, t, RESULT_LIMIT) : favouriteBangs(prepared, RESULT_LIMIT);
      list.hidden = mode !== "pick";
      if (list.hidden) return;
      if (sel >= results.length) sel = 0;
      if (!results.length) {
        const fb = fallback();
        list.append(el("li", "bs-empty", `No match. Enter searches ${fb ? fb.name : "the web"} for “${t}”`));
        return;
      }
      results.forEach((item, i) => {
        const b = item.b;
        const li = el("li", "bs-item" + (i === sel ? " sel" : ""));
        const text = el("div", "bs-text");
        text.append(el("div", "bs-name", b.name), el("div", "bs-sub", bangHost(b)));
        li.append(badge(b), text);
        if (b.favourite) li.append(el("span", "bs-star", "★"));
        li.append(el("span", "bs-tag", "!" + item.via));
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          sel = i;
          choose(item);
        });
        li.addEventListener("mousemove", () => {
          if (sel !== i) {
            sel = i;
            markSel();
          }
        });
        list.append(li);
      });
    }

    function choose(item) {
      current = item.b;
      currentVia = item.via;
      mode = "query";
      chip.textContent = (current.favourite ? "★ " : "") + "Search " + current.name;
      chip.hidden = false;
      glyph.hidden = true;
      input.value = "";
      input.placeholder = "Type your query…";
      renderList();
      setFoot();
      input.focus();
    }

    function back() {
      mode = "pick";
      chip.hidden = true;
      glyph.hidden = false;
      input.value = currentVia;
      input.placeholder = "Type a site, e.g. yt or youtube";
      sel = 0;
      renderList();
      setFoot();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }

    function submit(b, q, forceTab) {
      opts.onSubmit(targetUrl(b, q), forceTab ? "tab" : settings.openIn);
    }

    input.addEventListener("input", () => {
      if (mode !== "pick") return;
      let v = input.value;
      while (v && (v[0] === "!" || v[0] === settings.triggerKey)) v = v.slice(1);
      if (v !== input.value) input.value = v;
      sel = 0;
      renderList();
      setFoot();
    });

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        opts.onClose();
        return;
      }
      if (mode === "pick") {
        const t = input.value.trim();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (results.length) {
            e.preventDefault();
            sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
            markSel();
          }
        } else if (e.key === "Tab") {
          e.preventDefault();
          if (results.length) {
            sel = (sel + (e.shiftKey ? -1 : 1) + results.length) % results.length;
            markSel();
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (results.length) choose(results[sel]);
          else if (t && fallback()) submit(fallback(), t, e.ctrlKey || e.metaKey);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit(current, input.value.trim(), e.ctrlKey || e.metaKey);
      } else if (e.key === "Backspace" && !input.value) {
        e.preventDefault();
        back();
      } else if (e.key === "Tab") {
        e.preventDefault();
      }
    });
    input.addEventListener("keyup", (e) => e.stopPropagation());
    input.addEventListener("keypress", (e) => e.stopPropagation());

    gear.addEventListener("click", () => opts.onOptions());
    root.addEventListener("mousedown", (e) => {
      if (opts.overlay && e.target === root) opts.onClose();
    });

    renderList();
    setFoot();

    return {
      focus() {
        input.focus();
      },
      destroy() {
        root.remove();
        style.remove();
      }
    };
  }

  return { create, targetUrl };
})();
