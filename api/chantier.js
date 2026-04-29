// Vercel Serverless Function — Suivi de chantier
//
// Endpoints (resource= dans la query) :
//   phases       GET / POST / PATCH&id=
//   sitelog      GET / POST / DELETE&id=
//   qc           GET / POST / DELETE&id=
//   incidents    GET / POST / PATCH&id= / DELETE&id=
//
// Rate limit 30/min/IP.

import { supabase, backendError, setCors,
         safeStr, clientIp, rateLimit } from "./_supabase.js";

const MAX_TITLE = 200;
const MAX_BODY = 8000;

const PHASE_STATUS = ["planned","in_progress","blocked","done","cancelled"];
const QC_RESULT = ["pass","fail","pending","partial"];
const INC_TYPE = ["vol","accident","degat_meteo","retard","defaut_materiau","conflit","autre"];
const INC_SEVERITY = ["low","medium","high","critical"];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const sb = supabase();
  if (!sb) return backendError(res);

  const resource = req.query.resource ? String(req.query.resource) : null;
  const id = req.query.id ? String(req.query.id) : null;

  function rl() {
    return rateLimit(`chantier:${clientIp(req)}`, 30, 60);
  }

  try {
    // ─── PHASES ──────────────────────────────────────────────────────
    if (resource === "phases" && req.method === "GET") {
      const { data, error } = await sb
        .from("phases")
        .select("*")
        .order("position", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ phases: data || [] });
    }
    if (resource === "phases" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        code: safeStr(b.code, 20) || null,
        name: safeStr(b.name, MAX_TITLE),
        body_md: safeStr(b.body_md, MAX_BODY),
        status: PHASE_STATUS.includes(b.status) ? b.status : "planned",
        planned_start: b.planned_start || null,
        planned_end: b.planned_end || null,
        position: typeof b.position === "number" ? b.position : 999,
        is_public: typeof b.is_public === "boolean" ? b.is_public : true,
      };
      if (!insert.name) return res.status(400).json({ error: "Nom requis" });
      const { data, error } = await sb.from("phases").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ phase: data });
    }
    if (resource === "phases" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (typeof b.name === "string") update.name = safeStr(b.name, MAX_TITLE);
      if (typeof b.body_md === "string") update.body_md = safeStr(b.body_md, MAX_BODY);
      if (PHASE_STATUS.includes(b.status)) update.status = b.status;
      if (typeof b.percent_complete === "number") update.percent_complete = Math.max(0, Math.min(100, b.percent_complete | 0));
      if (b.planned_start !== undefined) update.planned_start = b.planned_start || null;
      if (b.planned_end !== undefined) update.planned_end = b.planned_end || null;
      if (b.real_start !== undefined) update.real_start = b.real_start || null;
      if (b.real_end !== undefined) update.real_end = b.real_end || null;
      if (typeof b.is_public === "boolean") update.is_public = b.is_public;
      if (typeof b.position === "number") update.position = b.position;
      if (typeof b.code === "string") update.code = safeStr(b.code, 20) || null;
      if (!Object.keys(update).length) return res.status(400).json({ error: "Rien à mettre à jour" });
      const { data, error } = await sb.from("phases").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ phase: data });
    }
    if (resource === "phases" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("phases").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── SITE LOG (journal quotidien) ────────────────────────────────
    if (resource === "sitelog" && req.method === "GET") {
      const limit = Math.min(parseInt(req.query.limit || "60"), 200);
      const { data, error } = await sb.from("site_log")
        .select("*")
        .order("log_date", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return res.status(200).json({ entries: data || [] });
    }
    if (resource === "sitelog" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        log_date: b.log_date || new Date().toISOString().slice(0,10),
        author: safeStr(b.author, 60) || "Lennon",
        body_md: safeStr(b.body_md, MAX_BODY),
        weather: safeStr(b.weather, 30) || null,
        electricity_outage_h: typeof b.electricity_outage_h === "number" ? b.electricity_outage_h : null,
        hours_lost_weather: typeof b.hours_lost_weather === "number" ? b.hours_lost_weather : null,
        photos: Array.isArray(b.photos) ? b.photos : [],
        is_public: typeof b.is_public === "boolean" ? b.is_public : true,
      };
      if (insert.body_md.length < 1) return res.status(400).json({ error: "Texte du journal requis" });
      const { data, error } = await sb.from("site_log").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ entry: data });
    }
    if (resource === "sitelog" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("site_log").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── QC INSPECTIONS ──────────────────────────────────────────────
    if (resource === "qc" && req.method === "GET") {
      const { data, error } = await sb.from("qc_inspections")
        .select("*")
        .order("performed_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ inspections: data || [] });
    }
    if (resource === "qc" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        phase_id: b.phase_id || null,
        type: safeStr(b.type, 60),
        performed_at: b.performed_at || new Date().toISOString(),
        performer: safeStr(b.performer, 60) || null,
        result: QC_RESULT.includes(b.result) ? b.result : "pending",
        expected: safeStr(b.expected, 200) || null,
        measured: safeStr(b.measured, 200) || null,
        lab_ref: safeStr(b.lab_ref, 60) || null,
        notes_md: safeStr(b.notes_md, MAX_BODY) || null,
        photos: Array.isArray(b.photos) ? b.photos : [],
        is_public: typeof b.is_public === "boolean" ? b.is_public : true,
      };
      if (!insert.type) return res.status(400).json({ error: "Type requis" });
      const { data, error } = await sb.from("qc_inspections").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ inspection: data });
    }
    if (resource === "qc" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("qc_inspections").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── INCIDENTS ───────────────────────────────────────────────────
    if (resource === "incidents" && req.method === "GET") {
      const { data, error } = await sb.from("incidents")
        .select("*")
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ incidents: data || [] });
    }
    if (resource === "incidents" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        occurred_at: b.occurred_at || new Date().toISOString(),
        type: INC_TYPE.includes(b.type) ? b.type : "autre",
        severity: INC_SEVERITY.includes(b.severity) ? b.severity : "low",
        body_md: safeStr(b.body_md, MAX_BODY),
        resolution_md: safeStr(b.resolution_md, MAX_BODY) || null,
        resolved_at: b.resolved_at || null,
        estimated_cost: typeof b.estimated_cost === "number" ? b.estimated_cost : null,
        estimated_cost_currency: ["MGA","EUR","USD"].includes(b.estimated_cost_currency) ? b.estimated_cost_currency : "MGA",
        photos: Array.isArray(b.photos) ? b.photos : [],
        is_public: typeof b.is_public === "boolean" ? b.is_public : false,
      };
      if (insert.body_md.length < 2) return res.status(400).json({ error: "Description requise" });
      const { data, error } = await sb.from("incidents").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ incident: data });
    }
    if (resource === "incidents" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (INC_SEVERITY.includes(b.severity)) update.severity = b.severity;
      if (typeof b.resolution_md === "string") update.resolution_md = safeStr(b.resolution_md, MAX_BODY);
      if (b.resolved_at !== undefined) update.resolved_at = b.resolved_at || null;
      if (typeof b.body_md === "string") update.body_md = safeStr(b.body_md, MAX_BODY);
      if (typeof b.is_public === "boolean") update.is_public = b.is_public;
      if (!Object.keys(update).length) return res.status(400).json({ error: "Rien à mettre à jour" });
      const { data, error } = await sb.from("incidents").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ incident: data });
    }
    if (resource === "incidents" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("incidents").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    return res.status(400).json({ error: "Resource ou méthode invalide", resource, method: req.method });
  } catch (err) {
    console.error("chantier api error", err);
    return res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message || err) });
  }
}
