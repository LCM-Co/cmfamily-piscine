/* Chan Ming POOL — Capture photo native + upload signed URL Supabase
 *
 * API :
 *   import { capturePhoto, uploadPhoto } from "./photo-capture.js";
 *
 *   const out = await capturePhoto({ maxWidth: 1600, quality: 0.75, requestGeo: true });
 *   // out = { blob, mimeType, width, height, geolocation? }
 *
 *   const rec = await uploadPhoto(out.blob, {
 *     mimeType: out.mimeType,
 *     caption: "Coulage radier",
 *     attached_to_type: "phase",
 *     attached_to_id: "<uuid>",
 *     is_public: true,
 *   });
 *   // rec = { path, public_url, photo? }
 */

const DEFAULTS = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.75,
  requestGeo: true,
  geoTimeoutMs: 4000,
  preferWebP: true,
  facing: "environment",
};

// ───────── Capture ─────────
export function capturePhoto(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", cfg.facing);
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";

    let settled = false;
    function bail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }
    function done(v) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(v);
    }
    function cleanup() { try { input.remove(); } catch (_) {} }

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) { bail(new Error("Aucun fichier sélectionné.")); return; }
      try {
        // Lance la géoloc en parallèle (best-effort)
        const geoPromise = cfg.requestGeo ? readGeo(cfg.geoTimeoutMs) : Promise.resolve(null);
        const compressed = await compressImage(file, cfg);
        const geolocation = await geoPromise.catch(() => null);
        done({
          ...compressed,
          geolocation,
        });
      } catch (e) { bail(e); }
    });

    input.addEventListener("cancel", () => bail(new Error("Capture annulée.")));

    document.body.appendChild(input);
    input.click();
  });
}

function readGeo(timeoutMs) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return; done = true; clearTimeout(t);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => { if (done) return; done = true; clearTimeout(t); resolve(null); },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: timeoutMs }
    );
  });
}

async function compressImage(file, cfg) {
  const bitmap = await loadBitmap(file);
  const { w, h } = fitWithin(bitmap.width, bitmap.height, cfg.maxWidth, cfg.maxHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) try { bitmap.close(); } catch (_) {}

  const wantWebP = cfg.preferWebP && supportsWebP();
  const mime = wantWebP ? "image/webp" : "image/jpeg";

  const blob = await new Promise((res, rej) => {
    canvas.toBlob((b) => b ? res(b) : rej(new Error("Compression échouée.")), mime, cfg.quality);
  });

  return { blob, mimeType: blob.type || mime, width: w, height: h };
}

function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error("Lecture image impossible.")); };
    img.src = url;
  });
}

function fitWithin(w, h, maxW, maxH) {
  const ratio = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * ratio), h: Math.round(h * ratio) };
}

let _webpCache = null;
function supportsWebP() {
  if (_webpCache !== null) return _webpCache;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _webpCache = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch (_) { _webpCache = false; }
  return _webpCache;
}

// ───────── Upload via signed URL Supabase ─────────
export async function uploadPhoto(blob, metadata = {}) {
  if (!blob) throw new Error("Blob requis.");
  const mime = metadata.mimeType || blob.type || "image/jpeg";
  const ext = mime === "image/webp" ? "webp" : (mime === "image/png" ? "png" : "jpg");
  const filename = `cm-${Date.now()}.${ext}`;

  // 1) Demande signed upload URL
  const sigResp = await fetch(`/api/upload?action=signed-url&filename=${encodeURIComponent(filename)}&mime=${encodeURIComponent(mime)}`);
  if (!sigResp.ok) {
    const txt = await sigResp.text();
    throw new Error(`signed-url failed (${sigResp.status}): ${txt}`);
  }
  const sig = await sigResp.json();
  // sig = { url, path, public_url, token? }

  // 2) PUT direct vers Supabase Storage (pas via Vercel)
  const putResp = await fetch(sig.url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-upsert": "false",
    },
    body: blob,
  });
  if (!putResp.ok) {
    const txt = await putResp.text();
    throw new Error(`upload PUT failed (${putResp.status}): ${txt}`);
  }

  // 3) Optionnel : enregistre la ligne en base via /api/upload?action=record
  let photoRow = null;
  if (metadata.recordInDb !== false) {
    try {
      const recResp = await fetch(`/api/upload?action=record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage_url: sig.public_url,
          storage_path: sig.path,
          caption: metadata.caption || null,
          location: metadata.geolocation ? `${metadata.geolocation.lat},${metadata.geolocation.lng}` : (metadata.location || null),
          taken_at: metadata.taken_at || new Date().toISOString(),
          attached_to_type: metadata.attached_to_type || null,
          attached_to_id: metadata.attached_to_id || null,
          is_public: typeof metadata.is_public === "boolean" ? metadata.is_public : true,
          width: metadata.width || null,
          height: metadata.height || null,
        }),
      });
      if (recResp.ok) photoRow = (await recResp.json()).photo || null;
    } catch (_) { /* non-bloquant */ }
  }

  return {
    path: sig.path,
    public_url: sig.public_url,
    photo: photoRow,
  };
}
