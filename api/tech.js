// Vercel Serverless Function — Espace technique (threads, messages, études)
//
// Endpoints :
//   GET  /api/tech?resource=threads               → liste threads
//   GET  /api/tech?resource=thread&id=UUID        → thread + messages
//   POST /api/tech?resource=thread                → crée { title, domain, is_public }
//   POST /api/tech?resource=message               → ajoute { thread_id, author, body_md }
//   PATCH /api/tech?resource=thread&id=UUID       → maj { status, is_public, title }
//   DELETE /api/tech?resource=thread&id=UUID      → supprime un thread (admin)
//
//   GET  /api/tech?resource=studies               → liste fiches d'étude
//   GET  /api/tech?resource=study&id=UUID         → détail fiche
//   PATCH /api/tech?resource=study&id=UUID        → maj { status, body_md, conclusions_md, is_public, formulas }
//
// Pour le MVP phase 2 : pas d'auth utilisateur — l'auteur est le nom saisi.
// Plus tard (P6) : magic link Supabase Auth.

import { supabase, backendError, setCors, checkAdmin,
         safeStr, clientIp, rateLimit } from "./_supabase.js";

const MAX_TITLE = 200;
const MAX_AUTHOR = 60;
const MAX_BODY = 8000;
const ALLOWED_DOMAIN = new Set(["structure","hydraulique","traitement_eau","electricite","tests_qualite","etancheite","general"]);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const sb = supabase();
  if (!sb) return backendError(res);

  const resource = req.query.resource ? String(req.query.resource) : null;
  const id = req.query.id ? String(req.query.id) : null;

  try {
    // ─── THREADS ─────────────────────────────────────────────────────
    if (resource === "threads" && req.method === "GET") {
      const { data, error } = await sb
        .from("tech_threads")
        .select("id, title, domain, status, is_public, last_message_at, created_at")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      // Compteur messages par thread
      const ids = (data || []).map(t => t.id);
      let counts = {};
      if (ids.length) {
        const { data: msgs } = await sb
          .from("tech_messages")
          .select("thread_id")
          .in("thread_id", ids);
        for (const m of msgs || []) counts[m.thread_id] = (counts[m.thread_id] || 0) + 1;
      }
      const enriched = (data || []).map(t => ({ ...t, message_count: counts[t.id] || 0 }));
      return res.status(200).json({ threads: enriched });
    }

    if (resource === "thread" && req.method === "GET") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const { data: t, error: e1 } = await sb
        .from("tech_threads").select("*").eq("id", id).maybeSingle();
      if (e1) throw e1;
      if (!t) return res.status(404).json({ error: "Thread inconnu" });
      const { data: msgs, error: e2 } = await sb
        .from("tech_messages")
        .select("id, author, body_md, attachments, created_at")
        .eq("thread_id", id)
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      return res.status(200).json({ thread: t, messages: msgs || [] });
    }

    if (resource === "thread" && req.method === "POST") {
      const body = req.body || {};
      const title = safeStr(body.title, MAX_TITLE);
      const domain = safeStr(body.domain, 30);
      const isPublic = !!body.is_public;
      if (title.length < 3) return res.status(400).json({ error: "Titre trop court" });
      if (!ALLOWED_DOMAIN.has(domain)) return res.status(400).json({ error: "Domaine invalide" });

      const ip = clientIp(req);
      const rl = rateLimit(`tech:${ip}`, 30, 60);
      if (!rl.ok) return res.status(429).json({ error: rl.error });

      const { data, error } = await sb
        .from("tech_threads")
        .insert({ title, domain, is_public: isPublic, status: "open" })
        .select("*").single();
      if (error) throw error;
      return res.status(200).json({ thread: data });
    }

    if (resource === "thread" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const body = req.body || {};
      const update = {};
      if (typeof body.title === "string") update.title = safeStr(body.title, MAX_TITLE);
      if (typeof body.domain === "string" && ALLOWED_DOMAIN.has(body.domain)) update.domain = body.domain;
      if (typeof body.status === "string" && ["open","closed","blocked"].includes(body.status)) update.status = body.status;
      if (typeof body.is_public === "boolean") update.is_public = body.is_public;
      if (!Object.keys(update).length) return res.status(400).json({ error: "Rien à mettre à jour" });
      const { data, error } = await sb
        .from("tech_threads").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ thread: data });
    }

    if (resource === "thread" && req.method === "DELETE") {
      const adm = checkAdmin(req);
      if (!adm.ok) return res.status(adm.code).json({ error: adm.error });
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("tech_threads").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── MESSAGES ────────────────────────────────────────────────────
    if (resource === "message" && req.method === "POST") {
      const body = req.body || {};
      const threadId = String(body.thread_id || "");
      const author = safeStr(body.author, MAX_AUTHOR);
      const bodyMd = safeStr(body.body_md, MAX_BODY);
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      if (!threadId) return res.status(400).json({ error: "thread_id requis" });
      if (author.length < 2) return res.status(400).json({ error: "Nom requis" });
      if (bodyMd.length < 1) return res.status(400).json({ error: "Message vide" });

      const ip = clientIp(req);
      const rl = rateLimit(`tech:${ip}`, 30, 60);
      if (!rl.ok) return res.status(429).json({ error: rl.error });

      const { data, error } = await sb
        .from("tech_messages")
        .insert({ thread_id: threadId, author, body_md: bodyMd, attachments })
        .select("*").single();
      if (error) throw error;
      // Mise à jour last_message_at
      await sb.from("tech_threads").update({ last_message_at: data.created_at }).eq("id", threadId);
      return res.status(200).json({ message: data });
    }

    // ─── STUDIES ─────────────────────────────────────────────────────
    if (resource === "studies" && req.method === "GET") {
      const { data, error } = await sb
        .from("tech_studies")
        .select("id, title, domain, status, is_public, validated_at, validated_by, updated_at")
        .order("domain", { ascending: true })
        .order("title", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ studies: data || [] });
    }

    if (resource === "study" && req.method === "GET") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const { data, error } = await sb
        .from("tech_studies").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Étude inconnue" });
      return res.status(200).json({ study: data });
    }

    if (resource === "study" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const body = req.body || {};
      const update = {};
      if (typeof body.title === "string") update.title = safeStr(body.title, MAX_TITLE);
      if (typeof body.body_md === "string") update.body_md = safeStr(body.body_md, MAX_BODY * 2);
      if (typeof body.conclusions_md === "string") update.conclusions_md = safeStr(body.conclusions_md, MAX_BODY);
      if (typeof body.is_public === "boolean") update.is_public = body.is_public;
      if (typeof body.status === "string" && ["draft","review","validated","obsolete"].includes(body.status)) update.status = body.status;
      if (Array.isArray(body.formulas)) update.formulas = body.formulas;
      if (body.status === "validated" && !update.validated_at) {
        update.validated_at = new Date().toISOString();
        update.validated_by = safeStr(body.validated_by, MAX_AUTHOR) || "Lennon";
      }
      if (!Object.keys(update).length) return res.status(400).json({ error: "Rien à mettre à jour" });
      const { data, error } = await sb
        .from("tech_studies").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ study: data });
    }

    return res.status(400).json({ error: "Resource ou méthode invalide", resource, method: req.method });
  } catch (err) {
    console.error("tech api error", err);
    return res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message || err) });
  }
}
