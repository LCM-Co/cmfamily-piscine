// Vercel Serverless Function — Logistique
//   Resources :
//     suppliers   GET / POST / PATCH&id= / DELETE&id=
//     orders      GET (avec lignes) / POST (avec lignes) / PATCH&id= / DELETE&id=
//     deliveries  GET / POST / PATCH&id= / DELETE&id=
//     stock       GET (mouvements) / POST / DELETE&id=
//     inventory   GET (vue agrégée par item)

import { supabase, backendError, setCors,
         safeStr, clientIp, rateLimit } from "./_supabase.js";

const ORDER_STATUS = ["draft","sent","confirmed","in_transit","customs","delivered","cancelled"];
const DELIVERY_STATUS = ["received","partial","rejected","disputed"];
const STOCK_DIRECTION = ["in","out","adjustment","loss"];
const CURRENCIES = ["MGA","EUR","USD"];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const sb = supabase();
  if (!sb) return backendError(res);

  const resource = req.query.resource ? String(req.query.resource) : null;
  const id = req.query.id ? String(req.query.id) : null;

  function rl() { return rateLimit(`log:${clientIp(req)}`, 30, 60); }

  try {
    // ─── SUPPLIERS ───────────────────────────────────────────────────
    if (resource === "suppliers" && req.method === "GET") {
      const { data, error } = await sb.from("suppliers")
        .select("*").order("name", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ suppliers: data || [] });
    }
    if (resource === "suppliers" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        name: safeStr(b.name, 200),
        country: safeStr(b.country, 5) || "MG",
        category: safeStr(b.category, 60) || null,
        contact: typeof b.contact === "object" ? b.contact : {},
        payment_terms: safeStr(b.payment_terms, 200) || null,
        quality_score: typeof b.quality_score === "number" ? b.quality_score : null,
        notes_md: safeStr(b.notes_md, 2000) || null,
      };
      if (!insert.name) return res.status(400).json({ error: "Nom requis" });
      const { data, error } = await sb.from("suppliers").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ supplier: data });
    }
    if (resource === "suppliers" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      for (const k of ["name","country","category","payment_terms","notes_md"]) {
        if (typeof b[k] === "string") update[k] = safeStr(b[k], 2000);
      }
      if (typeof b.contact === "object") update.contact = b.contact;
      if (typeof b.quality_score === "number") update.quality_score = b.quality_score;
      const { data, error } = await sb.from("suppliers").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ supplier: data });
    }
    if (resource === "suppliers" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("suppliers").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── ORDERS ──────────────────────────────────────────────────────
    if (resource === "orders" && req.method === "GET") {
      const { data: orders, error: e1 } = await sb.from("orders")
        .select("*").order("ordered_at", { ascending: false, nullsFirst: false });
      if (e1) throw e1;
      const ids = (orders || []).map(o => o.id);
      let lines = [];
      if (ids.length) {
        const { data: ls } = await sb.from("order_lines").select("*").in("order_id", ids);
        lines = ls || [];
      }
      const enriched = (orders || []).map(o => ({
        ...o,
        lines: lines.filter(l => l.order_id === o.id),
      }));
      return res.status(200).json({ orders: enriched });
    }
    if (resource === "orders" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        supplier_id: b.supplier_id || null,
        ref_external: safeStr(b.ref_external, 60) || null,
        ordered_at: b.ordered_at || null,
        expected_at: b.expected_at || null,
        status: ORDER_STATUS.includes(b.status) ? b.status : "draft",
        customs_status: safeStr(b.customs_status, 200) || null,
        total_currency: CURRENCIES.includes(b.total_currency) ? b.total_currency : "MGA",
        total_amount: typeof b.total_amount === "number" ? b.total_amount : 0,
        notes_md: safeStr(b.notes_md, 2000) || null,
      };
      const { data: order, error: e1 } = await sb.from("orders").insert(insert).select("*").single();
      if (e1) throw e1;
      // Lignes éventuelles
      if (Array.isArray(b.lines) && b.lines.length) {
        const linesPayload = b.lines.map(l => ({
          order_id: order.id,
          item: safeStr(l.item, 200),
          quantity: parseFloat(l.quantity) || 0,
          unit: safeStr(l.unit, 20) || "u",
          unit_price: parseFloat(l.unit_price) || 0,
          currency: CURRENCIES.includes(l.currency) ? l.currency : insert.total_currency,
          high_risk: !!l.high_risk,
        })).filter(l => l.item);
        if (linesPayload.length) await sb.from("order_lines").insert(linesPayload);
      }
      return res.status(200).json({ order });
    }
    if (resource === "orders" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (b.supplier_id !== undefined) update.supplier_id = b.supplier_id || null;
      if (typeof b.ref_external === "string") update.ref_external = safeStr(b.ref_external, 60);
      if (b.ordered_at !== undefined) update.ordered_at = b.ordered_at || null;
      if (b.expected_at !== undefined) update.expected_at = b.expected_at || null;
      if (ORDER_STATUS.includes(b.status)) update.status = b.status;
      if (typeof b.customs_status === "string") update.customs_status = safeStr(b.customs_status, 200);
      if (CURRENCIES.includes(b.total_currency)) update.total_currency = b.total_currency;
      if (typeof b.total_amount === "number") update.total_amount = b.total_amount;
      if (typeof b.notes_md === "string") update.notes_md = safeStr(b.notes_md, 2000);
      if (Object.keys(update).length) {
        const { error } = await sb.from("orders").update(update).eq("id", id);
        if (error) throw error;
      }
      // Si lines fourni, on remplace toutes les lignes
      if (Array.isArray(b.lines)) {
        await sb.from("order_lines").delete().eq("order_id", id);
        if (b.lines.length) {
          const linesPayload = b.lines.map(l => ({
            order_id: id,
            item: safeStr(l.item, 200),
            quantity: parseFloat(l.quantity) || 0,
            unit: safeStr(l.unit, 20) || "u",
            unit_price: parseFloat(l.unit_price) || 0,
            currency: CURRENCIES.includes(l.currency) ? l.currency : (update.total_currency || "MGA"),
            high_risk: !!l.high_risk,
          })).filter(l => l.item);
          if (linesPayload.length) await sb.from("order_lines").insert(linesPayload);
        }
      }
      const { data: order } = await sb.from("orders").select("*").eq("id", id).single();
      return res.status(200).json({ order });
    }
    if (resource === "orders" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("orders").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── DELIVERIES ──────────────────────────────────────────────────
    if (resource === "deliveries" && req.method === "GET") {
      const { data, error } = await sb.from("deliveries")
        .select("*").order("received_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ deliveries: data || [] });
    }
    if (resource === "deliveries" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        order_id: b.order_id || null,
        received_at: b.received_at || new Date().toISOString(),
        received_by: safeStr(b.received_by, 60) || null,
        status: DELIVERY_STATUS.includes(b.status) ? b.status : "received",
        discrepancies_md: safeStr(b.discrepancies_md, 2000) || null,
        photos: Array.isArray(b.photos) ? b.photos : [],
      };
      const { data, error } = await sb.from("deliveries").insert(insert).select("*").single();
      if (error) throw error;

      // Si lines de stock fournies, créer les mouvements stock_in correspondants
      if (Array.isArray(b.stock_in)) {
        const moves = b.stock_in.map(s => ({
          item: safeStr(s.item, 200),
          quantity: parseFloat(s.quantity) || 0,
          unit: safeStr(s.unit, 20) || "u",
          direction: "in",
          delivery_id: data.id,
          high_risk: !!s.high_risk,
          recorded_by: insert.received_by,
        })).filter(m => m.item && m.quantity > 0);
        if (moves.length) await sb.from("stock_movements").insert(moves);
      }

      // Si la commande liée existait, mettre status='delivered' si complète
      if (insert.order_id && insert.status === "received") {
        await sb.from("orders").update({ status: "delivered" }).eq("id", insert.order_id);
      }
      return res.status(200).json({ delivery: data });
    }
    if (resource === "deliveries" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (typeof b.status === "string" && DELIVERY_STATUS.includes(b.status)) update.status = b.status;
      if (typeof b.discrepancies_md === "string") update.discrepancies_md = safeStr(b.discrepancies_md, 2000);
      if (typeof b.received_by === "string") update.received_by = safeStr(b.received_by, 60);
      if (Array.isArray(b.photos)) update.photos = b.photos;
      const { data, error } = await sb.from("deliveries").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ delivery: data });
    }
    if (resource === "deliveries" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("deliveries").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── STOCK MOVEMENTS ─────────────────────────────────────────────
    if (resource === "stock" && req.method === "GET") {
      const { data, error } = await sb.from("stock_movements")
        .select("*").order("recorded_at", { ascending: false }).limit(200);
      if (error) throw error;
      return res.status(200).json({ movements: data || [] });
    }
    if (resource === "stock" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        item: safeStr(b.item, 200),
        quantity: parseFloat(b.quantity) || 0,
        unit: safeStr(b.unit, 20) || "u",
        direction: STOCK_DIRECTION.includes(b.direction) ? b.direction : "in",
        delivery_id: b.delivery_id || null,
        phase_id: b.phase_id || null,
        high_risk: !!b.high_risk,
        recorded_by: safeStr(b.recorded_by, 60) || null,
        notes: safeStr(b.notes, 500) || null,
      };
      if (!insert.item || insert.quantity <= 0) {
        return res.status(400).json({ error: "Item et quantité > 0 requis" });
      }
      const { data, error } = await sb.from("stock_movements").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ movement: data });
    }
    if (resource === "stock" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("stock_movements").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── INVENTORY (vue agrégée) ─────────────────────────────────────
    if (resource === "inventory" && req.method === "GET") {
      const { data, error } = await sb.from("stock_movements").select("*");
      if (error) throw error;
      // Agrégat par item
      const byItem = {};
      for (const m of data || []) {
        const key = m.item.toLowerCase().trim();
        if (!byItem[key]) byItem[key] = {
          item: m.item, unit: m.unit, current: 0, in: 0, out: 0,
          loss: 0, adjustment: 0, high_risk: false,
          last_move: null,
        };
        const x = byItem[key];
        if (m.direction === "in") { x.in += m.quantity; x.current += m.quantity; }
        else if (m.direction === "out") { x.out += m.quantity; x.current -= m.quantity; }
        else if (m.direction === "loss") { x.loss += m.quantity; x.current -= m.quantity; }
        else if (m.direction === "adjustment") { x.adjustment += m.quantity; x.current += m.quantity; }
        if (m.high_risk) x.high_risk = true;
        if (!x.last_move || m.recorded_at > x.last_move) x.last_move = m.recorded_at;
      }
      const inventory = Object.values(byItem).sort((a,b) => a.item.localeCompare(b.item));
      return res.status(200).json({ inventory });
    }

    return res.status(400).json({ error: "Resource ou méthode invalide", resource, method: req.method });
  } catch (err) {
    console.error("logistics api error", err);
    return res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message || err) });
  }
}
