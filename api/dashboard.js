// Vercel Serverless Function — Dashboard global
//
// Endpoint unique : GET /api/dashboard
// Renvoie en un seul appel toutes les agrégations utiles à la vue
// d'ensemble (KPIs, phases, budget, activité récente, décisions famille TODO).
//
// Conversion EUR : utilise expense.fx_rate_to_eur si présent, sinon le
// dernier fx_rates (eur_to_mga, usd_to_mga). Si pas de fx connu, le montant
// non-EUR est compté comme 0 (et la propriété fx_missing=true est remontée).

import { supabase, backendError, setCors } from "./_supabase.js";

const SEUIL_EXPENSE_EUR = 50;       // expenses > 50 EUR mises dans la timeline
const SEUIL_EXPENSE_MGA = 100000;   // ou > 100k MGA

function toEur(amount, currency, fx) {
  if (amount == null) return 0;
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  if (currency === "EUR") return n;
  if (!fx) return 0;
  if (currency === "MGA" && fx.eur_to_mga) return n / Number(fx.eur_to_mga);
  if (currency === "USD" && fx.usd_to_mga && fx.eur_to_mga) {
    return (n * Number(fx.usd_to_mga)) / Number(fx.eur_to_mga);
  }
  return 0;
}

function expenseToEur(e, fx) {
  if (e.fx_rate_to_eur && e.amount && Number(e.fx_rate_to_eur) !== 0) {
    return Number(e.amount) / Number(e.fx_rate_to_eur);
  }
  return toEur(Number(e.amount), e.currency, fx);
}

function previewMd(s, n = 140) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const sb = supabase();
  if (!sb) return backendError(res);

  try {
    // En parallèle : on lance toutes les requêtes
    const [
      phasesR, budgetR, expensesR, fxR,
      decisionsR, decActionsR, sitelogR, qcR,
      incidentsR, ordersR, deliveriesR, techMsgR, commentsR
    ] = await Promise.all([
      sb.from("phases")
        .select("id, code, name, status, percent_complete, planned_start, planned_end, real_start, real_end, position, updated_at, is_public")
        .order("position", { ascending: true }),
      sb.from("budget_lines").select("id, category, target_amount, currency, position").order("position", { ascending: true }),
      sb.from("expenses").select("id, budget_line_id, amount, currency, fx_rate_to_eur, paid_at, label, vendor"),
      sb.from("fx_rates").select("*").order("rate_date", { ascending: false }).limit(1),
      sb.from("decisions").select("id, title, body_md, decideur, status, updated_at, is_public").order("updated_at", { ascending: false }),
      sb.from("decision_actions").select("id, decision_id, action_type, author, payload, created_at").order("created_at", { ascending: false }).limit(60),
      sb.from("site_log").select("id, log_date, author, body_md, created_at").order("log_date", { ascending: false }).limit(30),
      sb.from("qc_inspections").select("id, type, performed_at, performer, result, expected, measured").order("performed_at", { ascending: false }).limit(30),
      sb.from("incidents").select("id, occurred_at, type, severity, body_md, resolved_at, estimated_cost, estimated_cost_currency").order("occurred_at", { ascending: false }).limit(30),
      sb.from("orders").select("id, ref_external, supplier_id, ordered_at, expected_at, status").order("expected_at", { ascending: true, nullsFirst: false }),
      sb.from("deliveries").select("id, order_id, received_at, received_by, status").order("received_at", { ascending: false }).limit(30),
      sb.from("tech_messages").select("id, thread_id, author, body_md, created_at").order("created_at", { ascending: false }).limit(30),
      // comments table peut ne pas exister (tolérant)
      sb.from("comments").select("id, target_kind, target_id, author, body_md, created_at").order("created_at", { ascending: false }).limit(30).then(r => r, () => ({ data: [] })),
    ]);

    const phases    = phasesR.data || [];
    const budget    = budgetR.data || [];
    const expenses  = expensesR.data || [];
    const fx        = (fxR.data && fxR.data[0]) || null;
    const decisions = decisionsR.data || [];
    const decAct    = decActionsR.data || [];
    const sitelog   = sitelogR.data || [];
    const qcs       = qcR.data || [];
    const incidents = incidentsR.data || [];
    const orders    = ordersR.data || [];
    const deliveries= deliveriesR.data || [];
    const techMsgs  = techMsgR.data || [];
    const comments  = (commentsR && commentsR.data) || [];

    // ─── Lookup suppliers (pour next delivery) ────────────────────────
    const suppliersIds = [...new Set(orders.map(o => o.supplier_id).filter(Boolean))];
    let suppliersMap = {};
    if (suppliersIds.length) {
      const { data: sup } = await sb.from("suppliers").select("id, name").in("id", suppliersIds);
      for (const s of sup || []) suppliersMap[s.id] = s.name;
    }

    // ─── KPIs ─────────────────────────────────────────────────────────
    // Avancement global = moyenne percent_complete des phases non cancelled
    const livePhases = phases.filter(p => p.status !== "cancelled");
    const advancement_pct = livePhases.length
      ? Math.round(livePhases.reduce((s, p) => s + (Number(p.percent_complete) || 0), 0) / livePhases.length)
      : 0;

    // Budget cible & consommé en EUR
    let budget_target_eur = 0;
    for (const l of budget) budget_target_eur += toEur(Number(l.target_amount), l.currency, fx);
    let budget_consumed_eur = 0;
    for (const e of expenses) budget_consumed_eur += expenseToEur(e, fx);

    // Décisions famille à trancher
    const decisions_todo_famille_arr = decisions.filter(d => d.decideur === "famille" && d.status === "todo");
    const decisions_todo_famille_count = decisions_todo_famille_arr.length;

    // Prochaine livraison attendue
    const now = new Date();
    const upcoming = orders
      .filter(o => o.expected_at && !["delivered", "cancelled"].includes(o.status))
      .filter(o => new Date(o.expected_at) >= new Date(now.getTime() - 24 * 3600 * 1000))
      .sort((a, b) => new Date(a.expected_at) - new Date(b.expected_at));
    const nextDelivery = upcoming[0]
      ? {
          date: upcoming[0].expected_at,
          supplier: suppliersMap[upcoming[0].supplier_id] || null,
          order_ref: upcoming[0].ref_external || upcoming[0].id,
        }
      : null;

    // Incidents non résolus
    const incidents_open = incidents.filter(i => !i.resolved_at).length;

    // Phases en cours
    const phases_in_progress = phases.filter(p => p.status === "in_progress").length;

    // ─── Budget par catégorie (regroupement par category) ─────────────
    const byCat = {};
    for (const l of budget) {
      const cat = l.category || "(autre)";
      if (!byCat[cat]) byCat[cat] = { category: cat, target_eur: 0, spent_eur: 0, line_ids: [] };
      byCat[cat].target_eur += toEur(Number(l.target_amount), l.currency, fx);
      byCat[cat].line_ids.push(l.id);
    }
    for (const e of expenses) {
      // retrouver la category via budget_line_id
      const line = budget.find(l => l.id === e.budget_line_id);
      const cat = line?.category || "(autre)";
      if (!byCat[cat]) byCat[cat] = { category: cat, target_eur: 0, spent_eur: 0, line_ids: [] };
      byCat[cat].spent_eur += expenseToEur(e, fx);
    }
    const budgetByCat = Object.values(byCat).map(c => ({
      category: c.category,
      target_eur: Math.round(c.target_eur * 100) / 100,
      spent_eur: Math.round(c.spent_eur * 100) / 100,
      percent_consumed: c.target_eur > 0 ? Math.round((c.spent_eur / c.target_eur) * 100) : null,
    })).sort((a, b) => b.target_eur - a.target_eur);

    // ─── Timeline activité ────────────────────────────────────────────
    const activity = [];
    for (const a of decAct) {
      const dec = decisions.find(d => d.id === a.decision_id);
      activity.push({
        type: "decision_action",
        icon: a.action_type === "validate" ? "✅"
            : a.action_type === "archive" ? "🗄"
            : a.action_type === "reopen" ? "↩"
            : a.action_type === "rectify" ? "✏"
            : "💬",
        title: `${a.action_type} — ${dec?.title || a.decision_id}`,
        author: a.author || "—",
        at: a.created_at,
        link: `decisions.html#dec-${a.decision_id}`,
      });
    }
    for (const p of phases) {
      if (!p.updated_at) continue;
      activity.push({
        type: "phase",
        icon: p.status === "done" ? "🏁"
            : p.status === "blocked" ? "⛔"
            : p.status === "in_progress" ? "🏗" : "📋",
        title: `Phase ${p.code || ""} ${p.name} — ${p.status} (${p.percent_complete || 0}%)`.trim(),
        author: null,
        at: p.updated_at,
        link: `chantier.html#phase-${p.id}`,
      });
    }
    for (const s of sitelog) {
      activity.push({
        type: "sitelog",
        icon: "📓",
        title: `Journal ${s.log_date}: ${previewMd(s.body_md, 80)}`,
        author: s.author,
        at: s.created_at || (s.log_date + "T12:00:00Z"),
        link: `chantier.html#sitelog-${s.id}`,
      });
    }
    for (const q of qcs) {
      activity.push({
        type: "qc",
        icon: q.result === "pass" ? "✅" : q.result === "fail" ? "❌" : q.result === "partial" ? "⚠" : "⏳",
        title: `QC ${q.type}: ${q.result}${q.measured ? ` (${q.measured})` : ""}`,
        author: q.performer || null,
        at: q.performed_at,
        link: `chantier.html#qc-${q.id}`,
      });
    }
    for (const i of incidents) {
      activity.push({
        type: "incident",
        icon: i.severity === "critical" ? "🚨" : i.severity === "high" ? "⚠" : "❗",
        title: `Incident ${i.type} (${i.severity}) — ${previewMd(i.body_md, 70)}`,
        author: null,
        at: i.occurred_at,
        link: `chantier.html#incident-${i.id}`,
      });
    }
    for (const d of deliveries) {
      const ord = orders.find(o => o.id === d.order_id);
      activity.push({
        type: "delivery",
        icon: d.status === "received" ? "📦" : d.status === "rejected" ? "❌" : "⚠",
        title: `Livraison ${d.status} — ${ord?.ref_external || ord?.id || "?"}`,
        author: d.received_by,
        at: d.received_at,
        link: `logistique.html#delivery-${d.id}`,
      });
    }
    for (const e of expenses) {
      const eur = expenseToEur(e, fx);
      const mga = e.currency === "MGA" ? Number(e.amount) : 0;
      if (eur >= SEUIL_EXPENSE_EUR || mga >= SEUIL_EXPENSE_MGA) {
        activity.push({
          type: "expense",
          icon: "💶",
          title: `Dépense ${Math.round(eur)} € — ${e.label || e.vendor || "?"}`,
          author: e.vendor || null,
          at: e.paid_at,
          link: `logistique.html#expense-${e.id}`,
        });
      }
    }
    for (const m of techMsgs) {
      activity.push({
        type: "tech_message",
        icon: "🔧",
        title: `Tech: ${previewMd(m.body_md, 80)}`,
        author: m.author,
        at: m.created_at,
        link: `technique.html#thread-${m.thread_id}`,
      });
    }
    for (const c of comments) {
      activity.push({
        type: "comment",
        icon: "💬",
        title: `Commentaire (${c.target_kind}): ${previewMd(c.body_md, 80)}`,
        author: c.author,
        at: c.created_at,
        link: null,
      });
    }
    // Tri desc, on ne garde que ceux avec une date utilisable
    const sortedActivity = activity
      .filter(a => a.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    // ─── Top décisions famille à trancher ─────────────────────────────
    const top_decisions = decisions_todo_famille_arr
      .slice(0, 4)
      .map(d => ({
        id: d.id,
        title: d.title || d.id,
        body_md_preview: previewMd(d.body_md, 220),
      }));

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      fx_used: fx ? {
        rate_date: fx.rate_date,
        eur_to_mga: fx.eur_to_mga,
        usd_to_mga: fx.usd_to_mga,
      } : null,
      kpis: {
        advancement_pct,
        budget_consumed_eur: Math.round(budget_consumed_eur),
        budget_target_eur: Math.round(budget_target_eur),
        decisions_todo_famille: decisions_todo_famille_count,
        next_delivery: nextDelivery,
        incidents_open,
        phases_in_progress,
      },
      phases: phases.map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        percent_complete: p.percent_complete || 0,
        planned_start: p.planned_start,
        planned_end: p.planned_end,
        real_start: p.real_start,
        real_end: p.real_end,
      })),
      budget: budgetByCat,
      activity: sortedActivity, // limit côté front : showMore par paquets
      decisions_todo_famille: top_decisions,
    });
  } catch (err) {
    console.error("dashboard api error", err);
    return res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message || err) });
  }
}
