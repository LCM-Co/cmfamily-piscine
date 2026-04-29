// Vercel Serverless Function — Photo upload (signed URL Supabase Storage + record)
//
// Endpoints :
//   GET  ?action=signed-url&filename=X.webp&mime=image/webp
//        → { url, path, public_url, token }
//        Génère un path {year}/{month}/{uuid}.{ext} dans bucket photos-chantier,
//        appelle createSignedUploadUrl(path) et renvoie l'URL signée
//        (le client fait ensuite un PUT direct, hors limite Vercel 4.5 MB).
//
//   POST ?action=record
//        Body JSON : { storage_url, storage_path, caption, location, taken_at,
//                      attached_to_type, attached_to_id, is_public, width, height }
//        Insère une ligne dans la table photos.
//
// Rate limit 10/min/IP via rateLimit("upload:"+ip, 10, 60).

import { supabase, backendError, setCors,
         safeStr, clientIp, rateLimit } from "./_supabase.js";
import crypto from "node:crypto";

const BUCKET = "photos-chantier";
const ALLOWED_MIME = ["image/webp", "image/jpeg", "image/jpg", "image/png"];
const MAX_FILENAME = 80;

function extFromMime(mime) {
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return "jpg";
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function buildPath(filename, mime) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = pad2(now.getUTCMonth() + 1);
  const ext = extFromMime(mime);
  const uuid = crypto.randomUUID();
  return `${year}/${month}/${uuid}.${ext}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const sb = supabase();
  if (!sb) return backendError(res);

  const action = req.query.action ? String(req.query.action) : null;
  const ip = clientIp(req);

  // Rate limit toutes les requêtes upload
  const rl = rateLimit("upload:" + ip, 10, 60);
  if (!rl.ok) return res.status(429).json({ error: rl.error });

  try {
    // ─── GET ?action=signed-url ───────────────────────────────────
    if (action === "signed-url" && req.method === "GET") {
      const filename = safeStr(req.query.filename || "", MAX_FILENAME);
      const mime = String(req.query.mime || "image/jpeg").toLowerCase();
      if (!ALLOWED_MIME.includes(mime)) {
        return res.status(400).json({ error: "MIME non autorisé", allowed: ALLOWED_MIME });
      }
      const path = buildPath(filename, mime);

      const { data, error } = await sb
        .storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error) {
        return res.status(500).json({ error: "createSignedUploadUrl failed", detail: error.message || String(error) });
      }

      // public_url car bucket configuré public read
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

      return res.status(200).json({
        url: data.signedUrl,
        token: data.token,
        path,
        bucket: BUCKET,
        public_url: pub?.publicUrl || null,
      });
    }

    // ─── POST ?action=record ──────────────────────────────────────
    if (action === "record" && req.method === "POST") {
      const b = req.body || {};
      const insert = {
        storage_url: safeStr(b.storage_url, 500) || null,
        storage_path: safeStr(b.storage_path, 300) || null,
        caption: safeStr(b.caption, 500) || null,
        location: safeStr(b.location, 80) || null,
        taken_at: b.taken_at || new Date().toISOString(),
        attached_to_type: safeStr(b.attached_to_type, 40) || null,
        attached_to_id: safeStr(b.attached_to_id, 80) || null,
        is_public: typeof b.is_public === "boolean" ? b.is_public : true,
        width: typeof b.width === "number" ? b.width : null,
        height: typeof b.height === "number" ? b.height : null,
      };
      if (!insert.storage_url && !insert.storage_path) {
        return res.status(400).json({ error: "storage_url ou storage_path requis" });
      }
      const { data, error } = await sb.from("photos").insert(insert).select("*").single();
      if (error) {
        return res.status(500).json({ error: "insert photos failed", detail: error.message || String(error) });
      }
      return res.status(200).json({ photo: data });
    }

    return res.status(400).json({ error: "Action ou méthode invalide", action, method: req.method });
  } catch (err) {
    console.error("upload api error", err);
    return res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message || err) });
  }
}
