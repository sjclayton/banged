const bangCollator = new Intl.Collator();

function bangTriggers(b) {
  return [b.bang, ...(Array.isArray(b.aliases) ? b.aliases : [])].filter(Boolean);
}

function bangHost(b) {
  const m = String(b.url || "").match(/^https?:\/\/(?:www\.)?([^\/?#:{]+)/i);
  return m ? m[1] : "";
}

function prepareBangs(bangs) {
  return bangs.map((b) => {
    const name = String(b.name || b.bang || "").toLowerCase();
    const orig = bangTriggers(b);
    return {
      b,
      orig,
      keys: orig.map((k) => k.toLowerCase()),
      name,
      words: name.split(/\s+/),
      host: bangHost(b).toLowerCase()
    };
  });
}

function scorePrepared(e, t) {
  let best = -1;
  let via = e.b.bang;
  for (let i = 0; i < e.keys.length; i++) {
    const key = e.keys[i];
    let s = -1;
    if (key === t) s = 5000;
    else if (key.startsWith(t)) s = 500;
    else if (key.includes(t)) s = 250;
    else if (t.length > 1 && [...t].every((c) => key.includes(c))) s = 50;
    if (s < 0) continue;
    s -= i;
    if (s > best) {
      best = s;
      via = e.orig[i];
    }
  }
  const ns = e.name.startsWith(t)
    ? 450
    : e.words.some((w) => w.startsWith(t))
    ? 300
    : e.name.includes(t)
    ? 200
    : e.host.includes(t)
    ? 120
    : -1;
  if (ns > best) {
    best = ns;
    via = e.b.bang;
  }
  if (best < 0) return null;
  const bonus = e.b.favourite ? (best >= 200 ? 2000 : 150) : 0;
  return { score: best + bonus, via };
}

function searchBangs(prepared, typed, limit) {
  const t = typed.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return [];
  const tokens = t.split(" ");
  const out = [];
  for (const e of prepared) {
    // The whole phrase (e.g. "stack overflow") is tried first, then every word must match on its own.
    let r = scorePrepared(e, t);
    if (!r && tokens.length > 1) {
      let total = 0;
      let via = null;
      for (const tok of tokens) {
        const x = scorePrepared(e, tok);
        if (!x) {
          total = -1;
          break;
        }
        total += x.score;
        if (!via) via = x.via;
      }
      if (total >= 0) r = { score: Math.floor(total / tokens.length), via };
    }
    if (r) out.push({ b: e.b, via: r.via, score: r.score });
  }
  out.sort((a, c) => c.score - a.score || bangCollator.compare(a.b.bang, c.b.bang));
  return out.slice(0, limit);
}

function favouriteBangs(prepared, limit) {
  const byBang = (a, c) => bangCollator.compare(a.b.bang, c.b.bang);
  const favs = prepared.filter((e) => e.b.favourite).sort(byBang).slice(0, limit);
  const out = favs.slice();
  if (out.length < limit) {
    // Only the first few non-favourites are needed, so avoid sorting a huge list.
    const need = limit - out.length;
    const top = [];
    for (const e of prepared) {
      if (e.b.favourite) continue;
      if (top.length === need && byBang(e, top[top.length - 1]) >= 0) continue;
      let k = top.length;
      while (k > 0 && byBang(e, top[k - 1]) < 0) k--;
      top.splice(k, 0, e);
      if (top.length > need) top.pop();
    }
    out.push(...top);
  }
  return out.map((e) => ({ b: e.b, via: e.b.bang, score: 0 }));
}

function triggerMap(bangs) {
  const m = new Map();
  for (const b of bangs) {
    for (const k of bangTriggers(b)) {
      const key = k.toLowerCase();
      if (!m.has(key)) m.set(key, b);
    }
  }
  return m;
}
