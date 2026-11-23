// Site icons. The background script fetches and caches them (so pages' own
// security policies never block anything); here we only turn the cached bytes
// into something drawable. Drawing through a canvas means even pages with a
// strict Content-Security-Policy can't prevent the icons from showing.
const faviconBitmaps = new Map();

function bangOrigin(b) {
  try {
    return new URL(String(b.url).replace(/\{\{\{(s|raw)\}\}\}.*$/, "")).origin;
  } catch (e) {
    return null;
  }
}

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "image/x-icon" });
}

function loadFaviconSource(origin) {
  if (!faviconBitmaps.has(origin)) {
    const p = browser.runtime
      .sendMessage({ type: "favicon", origin })
      .then(async (res) => {
        if (!res || !res.b64) return null;
        const blob = b64ToBlob(res.b64, res.mime);
        try {
          return { bitmap: await createImageBitmap(blob) };
        } catch (e) {
          return { url: "data:" + (res.mime || "image/x-icon") + ";base64," + res.b64 };
        }
      })
      .catch(() => null);
    faviconBitmaps.set(origin, p);
  }
  return faviconBitmaps.get(origin);
}

// Resolves to an element showing the site's icon at `size` CSS pixels, or null.
async function faviconElement(origin, size) {
  const src = await loadFaviconSource(origin);
  if (!src) return null;
  if (src.bitmap) {
    const dpr = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
    const c = document.createElement("canvas");
    c.width = c.height = size * dpr;
    c.style.cssText = `width:${size}px;height:${size}px;display:block`;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src.bitmap, 0, 0, c.width, c.height);
    return c;
  }
  const img = document.createElement("img");
  img.width = img.height = size;
  img.style.cssText = "display:block";
  return new Promise((resolve) => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src.url;
  });
}
