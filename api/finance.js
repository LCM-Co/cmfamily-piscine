// Vercel Serverless Function — Finance
//   Resources :
//     budget       GET (avec total dépensé) / POST / PATCH&id= / DELETE&id=
//     expenses     GET (filtrable) / POST / PATCH&id= / DELETE&id=
//     fxrates      GET (dernier + historique) / POST (saisie manuelle)
//     team         GET / POST / PATCH&id= / DELETE&id=
//     attendance   GET (filtrable par membre/mois) / POST / PATCH&id= / DELETE&id=
//     summary      GET (agrégat dashboard cash flow)

import { supabase, backendError, setCors,
         safeStr, clientIp, rateLimit } from "./_supabase.js";

const CURRENCIES = ["MGA", "EUR", "USD"];
const PAYMENT_MODES = ["cash", "transfer", "mobile_money", "check", "other"];
const CASH_VALIDATION_THRESHOLD_MGA = 100000;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// Convertit un montant en EUR. Si fx_rate_to_eur n'est pas fourni, utilise les taux.
function toEur(amount, currency, fxByDate, fallbackRates) {
  if (amount == null) return 0;
  if (currency === "EUR") return amount;
  // fallbackRates = { eur_to_mga, usd_to_mga }
  if (!fallbackRates) return 0;
  if (currency === "MGA" && fallbackRates.eur_to_mga) return amount / fallbackRates.eur_to_mga;
  if (currency === "USD" && fallbackRates.eur_to_mga && fallbackRates.usd_to_mga) {
    // USD → MGA → EUR
    return (amount * fallbackRates.usd_to_mga) / fallbackRates.eur_to_mga;
  }
  return 0;
}

async function latestFxRate(sb) {
  const { data } = await sb.from("fx_rates")
    .select("*")
    .order("rate_date", { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const sb = supabase();
  if (!sb) return backendError(res);

  const resource = req.query.resource ? String(req.query.resource) : null;
  const id = req.query.id ? String(req.query.id) : null;

  function rl() { return rateLimit(`fin:${clientIp(req)}`, 30, 60); }

  try {
    // ─── BUDGET ──────────────────────────────────────────────────────
    if (resource === "budget" && req.method === "GET") {
      const { data: lines, error } = await sb.from("budget_lines")
        .select("*").order("position", { ascending: true });
      if (error) throw error;
      const ids = (lines || []).map(l => l.id);
      let expenses = [];
      if (ids.length) {
        const { data: ex } = await sb.from("expenses")
          .select("budget_line_id, amount, currency, fx_rate_to_eur")
          .in("budget_line_id", ids);
        expenses = ex || [];
      }
      const fx = await latestFxRate(sb);
      const fallback = fx ? { eur_to_mga: fx.eur_to_mga, usd_to_mga: fx.usd_to_mga } : null;

      // total dépensé par ligne, en EUR (pour comparer à target_amount converti aussi en EUR)
      const spentByLine = {};
      for (const e of expenses) {
        const k = e.budget_line_id;
        if (!spentByLine[k]) spentByLine[k] = { eur: 0, mga: 0, count: 0 };
        const eur = e.fx_rate_to_eur && e.amount
          ? Number(e.amount) / Number(e.fx_rate_to_eur)
          : toEur(Number(e.amount), e.currency, null, fallback);
        spentByLine[k].eur += eur;
        // équiv MGA pour les vues locales
        if (e.currency === "MGA") spentByLine[k].mga += Number(e.amount);
        else if (fallback?.eur_to_mga) spentByLine[k].mga += eur * fallback.eur_to_mga;
        spentByLine[k].count++;
      }

      const enriched = (lines || []).map(l => {
        const spent = spentByLine[l.id] || { eur: 0, mga: 0, count: 0 };
        const targetEur = toEur(Number(l.target_amount), l.currency, null, fallback);
        const remainingEur = targetEur - spent.eur;
        const pct = targetEur > 0 ? (spent.eur / targetEur) * 100 : 0;
        return {
          ...l,
          spent_eur: spent.eur,
          spent_mga: spent.mga,
          target_eur: targetEur,
          remaining_eur: remainingEur,
          consumed_pct: pct,
          expense_count: spent.count,
        };
      });

      return res.status(200).json({ budget: enriched, fx });
    }

    if (resource === "budget" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        category: safeStr(b.category, 60),
        subcategory: safeStr(b.subcategory, 100) || null,
        target_amount: num(b.target_amount) || 0,
        currency: CURRENCIES.includes(b.currency) ? b.currency : "MGA",
        notes_md: safeStr(b.notes_md, 4000) || null,
        is_public: bool(b.is_public),
        position: num(b.position) ?? 0,
      };
      if (!insert.category) return res.status(400).json({ error: "Catégorie requise" });
      const { data, error } = await sb.from("budget_lines").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ budget_line: data });
    }

    if (resource === "budget" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (typeof b.category === "string") update.category = safeStr(b.category, 60);
      if (typeof b.subcategory === "string") update.subcategory = safeStr(b.subcategory, 100);
      if (b.target_amount !== undefined) update.target_amount = num(b.target_amount) || 0;
      if (CURRENCIES.includes(b.currency)) update.currency = b.currency;
      if (typeof b.notes_md === "string") update.notes_md = safeStr(b.notes_md, 4000);
      if (b.is_public !== undefined) update.is_public = bool(b.is_public);
      if (b.position !== undefined) update.position = num(b.position) ?? 0;
      update.updated_at = new Date().toISOString();
      const { data, error } = await sb.from("budget_lines").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ budget_line: data });
    }

    if (resource === "budget" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("budget_lines").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── EXPENSES ────────────────────────────────────────────────────
    if (resource === "expenses" && req.method === "GET") {
      let q = sb.from("expenses").select("*").order("paid_at", { ascending: false, nullsFirst: false });
      if (req.query.budget_line_id) q = q.eq("budget_line_id", String(req.query.budget_line_id));
      if (req.query.supplier_id) q = q.eq("supplier_id", String(req.query.supplier_id));
      if (req.query.payment_mode) q = q.eq("payment_mode", String(req.query.payment_mode));
      if (req.query.from) q = q.gte("paid_at", String(req.query.from));
      if (req.query.to) q = q.lte("paid_at", String(req.query.to));
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ expenses: data || [] });
    }

    if (resource === "expenses" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const amount = num(b.amount);
      if (amount == null || amount <= 0) return res.status(400).json({ error: "Montant > 0 requis" });
      const currency = CURRENCIES.includes(b.currency) ? b.currency : "MGA";
      const paymentMode = PAYMENT_MODES.includes(b.payment_mode) ? b.payment_mode : "cash";

      // Auto-conversion en EUR si pas fourni
      let fxRateToEur = num(b.fx_rate_to_eur);
      if (!fxRateToEur) {
        if (currency === "EUR") fxRateToEur = 1;
        else {
          const fx = await latestFxRate(sb);
          if (fx) {
            if (currency === "MGA" && fx.eur_to_mga) fxRateToEur = fx.eur_to_mga;
            else if (currency === "USD" && fx.eur_to_mga && fx.usd_to_mga) {
              // 1 EUR = (eur_to_mga/usd_to_mga) USD ⇒ amount(USD)/fxRateToEur = montant en EUR
              fxRateToEur = fx.eur_to_mga / fx.usd_to_mga;
            }
          }
        }
      }

      // Double validation espèces si cash et > seuil MGA
      let amountEqMga = amount;
      if (currency === "EUR" && fxRateToEur) amountEqMga = amount * fxRateToEur;
      else if (currency === "USD" && fxRateToEur) {
        const fx = await latestFxRate(sb);
        amountEqMga = fx?.usd_to_mga ? amount * fx.usd_to_mga : amount * fxRateToEur;
      }
      if (paymentMode === "cash" && amountEqMga > CASH_VALIDATION_THRESHOLD_MGA && !safeStr(b.validated_by_2nd, 60)) {
        return res.status(400).json({ error: "Double validation requise pour une dépense espèces > 100 000 MGA (champ validated_by_2nd)" });
      }

      const insert = {
        budget_line_id: b.budget_line_id || null,
        amount,
        currency,
        fx_rate_to_eur: fxRateToEur || null,
        paid_at: b.paid_at || null,
        payment_mode: paymentMode,
        supplier_id: b.supplier_id || null,
        order_id: b.order_id || null,
        description: safeStr(b.description, 500) || null,
        validated_by_2nd: safeStr(b.validated_by_2nd, 60) || null,
        validated_at: b.validated_by_2nd ? new Date().toISOString() : null,
        receipt_url: safeStr(b.receipt_url, 500) || null,
        is_public: bool(b.is_public),
      };

      const { data, error } = await sb.from("expenses").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ expense: data });
    }

    if (resource === "expenses" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (b.budget_line_id !== undefined) update.budget_line_id = b.budget_line_id || null;
      if (b.amount !== undefined) update.amount = num(b.amount);
      if (CURRENCIES.includes(b.currency)) update.currency = b.currency;
      if (b.fx_rate_to_eur !== undefined) update.fx_rate_to_eur = num(b.fx_rate_to_eur);
      if (b.paid_at !== undefined) update.paid_at = b.paid_at || null;
      if (PAYMENT_MODES.includes(b.payment_mode)) update.payment_mode = b.payment_mode;
      if (b.supplier_id !== undefined) update.supplier_id = b.supplier_id || null;
      if (b.order_id !== undefined) update.order_id = b.order_id || null;
      if (typeof b.description === "string") update.description = safeStr(b.description, 500);
      if (typeof b.validated_by_2nd === "string") {
        update.validated_by_2nd = safeStr(b.validated_by_2nd, 60) || null;
        update.validated_at = update.validated_by_2nd ? new Date().toISOString() : null;
      }
      if (typeof b.receipt_url === "string") update.receipt_url = safeStr(b.receipt_url, 500);
      if (b.is_public !== undefined) update.is_public = bool(b.is_public);
      const { data, error } = await sb.from("expenses").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ expense: data });
    }

    if (resource === "expenses" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("expenses").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── FX RATES ────────────────────────────────────────────────────
    if (resource === "fxrates" && req.method === "GET") {
      const { data, error } = await sb.from("fx_rates")
        .select("*").order("rate_date", { ascending: false }).limit(60);
      if (error) throw error;
      return res.status(200).json({ rates: data || [], latest: (data && data[0]) || null });
    }

    if (resource === "fxrates" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        rate_date: b.rate_date || new Date().toISOString().slice(0, 10),
        eur_to_mga: num(b.eur_to_mga),
        usd_to_mga: num(b.usd_to_mga),
        source: safeStr(b.source, 200) || "manuel",
      };
      if (!insert.eur_to_mga || !insert.usd_to_mga) {
        return res.status(400).json({ error: "eur_to_mga et usd_to_mga requis" });
      }
      // upsert (rate_date PK)
      const { data, error } = await sb.from("fx_rates").upsert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ rate: data });
    }

    // ─── TEAM ────────────────────────────────────────────────────────
    if (resource === "team" && req.method === "GET") {
      const { data, error } = await sb.from("team_members")
        .select("*").order("active", { ascending: false }).order("name", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ team: data || [] });
    }

    if (resource === "team" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        name: safeStr(b.name, 200),
        role: safeStr(b.role, 100) || null,
        daily_rate_mga: num(b.daily_rate_mga) || 0,
        contact: typeof b.contact === "object" && b.contact ? b.contact : {},
        active: b.active === undefined ? true : bool(b.active),
        notes: safeStr(b.notes, 500) || null,
      };
      if (!insert.name) return res.status(400).json({ error: "Nom requis" });
      const { data, error } = await sb.from("team_members").insert(insert).select("*").single();
      if (error) throw error;
      return res.status(200).json({ member: data });
    }

    if (resource === "team" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (typeof b.name === "string") update.name = safeStr(b.name, 200);
      if (typeof b.role === "string") update.role = safeStr(b.role, 100);
      if (b.daily_rate_mga !== undefined) update.daily_rate_mga = num(b.daily_rate_mga) || 0;
      if (typeof b.contact === "object" && b.contact) update.contact = b.contact;
      if (b.active !== undefined) update.active = bool(b.active);
      if (typeof b.notes === "string") update.notes = safeStr(b.notes, 500);
      const { data, error } = await sb.from("team_members").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ member: data });
    }

    if (resource === "team" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("team_members").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── ATTENDANCE ──────────────────────────────────────────────────
    if (resource === "attendance" && req.method === "GET") {
      let q = sb.from("attendance").select("*").order("attendance_date", { ascending: false });
      if (req.query.member_id) q = q.eq("member_id", String(req.query.member_id));
      if (req.query.from) q = q.gte("attendance_date", String(req.query.from));
      if (req.query.to) q = q.lte("attendance_date", String(req.query.to));
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ attendance: data || [] });
    }

    if (resource === "attendance" && req.method === "POST") {
      const r = rl(); if (!r.ok) return res.status(429).json({ error: r.error });
      const b = req.body || {};
      const insert = {
        member_id: b.member_id || null,
        attendance_date: b.attendance_date || new Date().toISOString().slice(0, 10),
        hours: num(b.hours) ?? 8,
        paid_at: b.paid_at || null,
        payment_mode: PAYMENT_MODES.includes(b.payment_mode) ? b.payment_mode : null,
        amount_paid_mga: num(b.amount_paid_mga),
        notes: safeStr(b.notes, 300) || null,
      };
      if (!insert.member_id) return res.status(400).json({ error: "member_id requis" });
      // upsert sur (member_id, attendance_date) UNIQUE
      const { data, error } = await sb.from("attendance")
        .upsert(insert, { onConflict: "member_id,attendance_date" })
        .select("*").single();
      if (error) throw error;
      return res.status(200).json({ attendance: data });
    }

    if (resource === "attendance" && req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id requis" });
      const b = req.body || {};
      const update = {};
      if (b.hours !== undefined) update.hours = num(b.hours) ?? 8;
      if (b.paid_at !== undefined) update.paid_at = b.paid_at || null;
      if (b.payment_mode !== undefined) {
        update.payment_mode = PAYMENT_MODES.includes(b.payment_mode) ? b.payment_mode : null;
      }
      if (b.amount_paid_mga !== undefined) update.amount_paid_mga = num(b.amount_paid_mga);
      if (typeof b.notes === "string") update.notes = safeStr(b.notes, 300);
      const { data, error } = await sb.from("attendance").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ attendance: data });
    }

    if (resource === "attendance" && req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id requis" });
      await sb.from("attendance").delete().eq("id", id);
      return res.status(200).json({ ok: true, deleted: id });
    }

    // ─── SUMMARY ─────────────────────────────────────────────────────
    if (resource === "summary" && req.method === "GET") {
      const fx = await latestFxRate(sb);
      const fallback = fx ? { eur_to_mga: fx.eur_to_mga, usd_to_mga: fx.usd_to_mga } : null;

      const [{ data: budget }, { data: expenses }] = await Promise.all([
        sb.from("budget_lines").select("*"),
        sb.from("expenses").select("*"),
      ]);

      // Totaux budget
      let totalBudgetEur = 0;
      const byCategory = {};
      for (const l of budget || []) {
        const eur = toEur(Number(l.target_amount), l.currency, null, fallback);
        totalBudgetEur += eur;
        byCategory[l.category] = byCategory[l.category] || { category: l.category, target_eur: 0, spent_eur: 0 };
        byCategory[l.category].target_eur += eur;
      }

      // Totaux dépenses + agrégat 12 mois + par mode
      const now = new Date();
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key: d.toISOString().slice(0, 7),
          label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
          total_eur: 0,
          total_mga: 0,
          count: 0,
        });
      }
      const monthIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));

      let totalSpentEur = 0;
      let cashEur = 0, transferEur = 0, otherEur = 0;
      const lineToCat = {};
      for (const l of budget || []) lineToCat[l.id] = l.category;

      for (const e of expenses || []) {
        const eur = e.fx_rate_to_eur && e.amount
          ? Number(e.amount) / Number(e.fx_rate_to_eur)
          : toEur(Number(e.amount), e.currency, null, fallback);
        totalSpentEur += eur;
        if (e.payment_mode === "cash") cashEur += eur;
        else if (e.payment_mode === "transfer") transferEur += eur;
        else otherEur += eur;

        if (e.budget_line_id && lineToCat[e.budget_line_id]) {
          const cat = lineToCat[e.budget_line_id];
          if (byCategory[cat]) byCategory[cat].spent_eur += eur;
        }

        if (e.paid_at) {
          const k = String(e.paid_at).slice(0, 7);
          const idx = monthIdx[k];
          if (idx !== undefined) {
            months[idx].total_eur += eur;
            months[idx].count++;
            if (fallback?.eur_to_mga) months[idx].total_mga += eur * fallback.eur_to_mga;
          }
        }
      }

      // Cumul depuis début
      let cum = 0;
      for (const m of months) { cum += m.total_eur; m.cumulative_eur = cum; }

      return res.status(200).json({
        fx,
        kpis: {
          total_budget_eur: totalBudgetEur,
          total_spent_eur: totalSpentEur,
          remaining_eur: totalBudgetEur - totalSpentEur,
          consumed_pct: totalBudgetEur > 0 ? (totalSpentEur / totalBudgetEur) * 100 : 0,
          cash_eur: cashEur,
          transfer_eur: transferEur,
          other_eur: otherEur,
        },
        months,
        by_category: Object.values(byCategory).sort((a, b) => b.target_eur - a.target_eur),
      });
    }

    return res.status(400).json({ error: "Resource ou méthode invalide", resource, method: req.method });
  } catch (err) {
    console.error("finance api error", err);
    return res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message || err) });
  }
}
