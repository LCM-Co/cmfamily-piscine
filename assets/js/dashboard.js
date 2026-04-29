/* Dashboard — frontend (KPIs, phases, budget, timeline, partage WhatsApp) */
(function () {
  "use strict";

  const API = "/api/dashboard";
  const TIMELINE_PAGE = 30;

  // ─── DOM helper ────────────────────────────────────────────────────
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "className") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        e.setAttribute(k, v);
      }
    }
    for (const c of kids) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }

  function fmtDate(iso, withTime = false) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  }

  function fmtRelative(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const diffMs = Date.now() - d.getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const j = Math.round(h / 24);
    if (j < 7) return `il y a ${j} j`;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  }

  function fmtEur(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Math.round(Number(n));
    return v.toLocaleString("fr-FR") + " €";
  }

  // ─── State ─────────────────────────────────────────────────────────
  const state = {
    data: null,
    timelineShown: TIMELINE_PAGE,
  };

  // ─── Fetch ─────────────────────────────────────────────────────────
  async function load() {
    setBusy(true);
    try {
      const r = await fetch(API, { headers: { "Accept": "application/json" } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      state.data = j;
      state.timelineShown = TIMELINE_PAGE;
      render();
    } catch (err) {
      renderError(err);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(b) {
    const btn = document.getElementById("btn-refresh");
    if (btn) btn.disabled = !!b;
  }

  function renderError(err) {
    const grid = document.getElementById("kpi-grid");
    if (grid) {
      grid.innerHTML = "";
      grid.append(el("p", { className: "empty-state" },
        "Impossible de charger le tableau de bord : ", String(err.message || err)));
    }
  }

  // ─── Renderers ─────────────────────────────────────────────────────
  function render() {
    const d = state.data;
    if (!d) return;
    const gen = document.getElementById("dash-generated");
    if (gen) gen.textContent = "Mis à jour " + fmtRelative(d.generated_at);
    renderKpis(d.kpis);
    renderPhases(d.phases);
    renderBudget(d.budget);
    renderDecisions(d.decisions_todo_famille);
    renderTimeline(d.activity);
  }

  function renderKpis(k) {
    const grid = document.getElementById("kpi-grid");
    grid.innerHTML = "";
    if (!k) {
      grid.append(el("p", { className: "empty-state" }, "Aucune donnée."));
      return;
    }

    grid.append(kpiCard({
      label: "Avancement global",
      value: (k.advancement_pct || 0) + " %",
      sub: (k.phases_in_progress || 0) + " phase(s) en cours",
      tone: k.advancement_pct >= 90 ? "ok" : null,
    }));

    const pctBudget = k.budget_target_eur > 0
      ? Math.round((k.budget_consumed_eur / k.budget_target_eur) * 100)
      : null;
    grid.append(kpiCard({
      label: "Budget consommé",
      value: fmtEur(k.budget_consumed_eur),
      sub: k.budget_target_eur
        ? `sur ${fmtEur(k.budget_target_eur)}` + (pctBudget != null ? ` (${pctBudget} %)` : "")
        : "—",
      tone: pctBudget != null && pctBudget > 100 ? "warn" : (pctBudget > 80 ? "alert" : null),
    }));

    grid.append(kpiCard({
      label: "Décisions famille",
      value: String(k.decisions_todo_famille || 0),
      sub: "à trancher",
      tone: (k.decisions_todo_famille || 0) > 0 ? "alert" : "ok",
    }));

    if (k.next_delivery && k.next_delivery.date) {
      grid.append(kpiCard({
        label: "Prochaine livraison",
        value: fmtDate(k.next_delivery.date),
        sub: (k.next_delivery.supplier || k.next_delivery.order_ref || "") + "",
      }));
    } else {
      grid.append(kpiCard({
        label: "Prochaine livraison",
        value: "—",
        sub: "rien prévu",
      }));
    }

    grid.append(kpiCard({
      label: "Incidents ouverts",
      value: String(k.incidents_open || 0),
      sub: (k.incidents_open || 0) === 0 ? "aucun" : "non résolus",
      tone: (k.incidents_open || 0) > 0 ? "warn" : "ok",
    }));

    grid.append(kpiCard({
      label: "Phases en cours",
      value: String(k.phases_in_progress || 0),
      sub: "actives",
    }));
  }

  function kpiCard({ label, value, sub, tone }) {
    const cls = "kpi-card" + (tone ? " kpi-" + tone : "");
    return el("div", { className: cls },
      el("div", { className: "kpi-label" }, label),
      el("div", { className: "kpi-value" }, value),
      el("div", { className: "kpi-sub" }, sub || "")
    );
  }

  function renderPhases(phases) {
    const wrap = document.getElementById("phases-bars");
    wrap.innerHTML = "";
    if (!phases || !phases.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune phase."));
      return;
    }
    for (const p of phases) {
      const pct = Math.max(0, Math.min(100, Number(p.percent_complete) || 0));
      const dates = [];
      if (p.planned_start || p.planned_end) {
        dates.push(`Prévu ${p.planned_start ? fmtDate(p.planned_start) : "?"} → ${p.planned_end ? fmtDate(p.planned_end) : "?"}`);
      }
      if (p.real_start || p.real_end) {
        dates.push(`Réel ${p.real_start ? fmtDate(p.real_start) : "?"} → ${p.real_end ? fmtDate(p.real_end) : "en cours"}`);
      }
      const fill = el("div", {
        className: "phase-bar-fill s-" + p.status,
        style: `width:${pct}%`,
      }, pct >= 12 ? `${pct}%` : "");

      const head = el("div", { className: "phase-row-head" },
        el("div", { className: "phase-row-name" },
          p.code ? el("span", { className: "phase-code" }, p.code) : null,
          p.name || ""),
        el("span", { className: "phase-status-badge s-" + p.status }, p.status || "—"),
      );
      const meta = dates.length
        ? el("div", { className: "phase-row-meta" }, ...dates.map(t => el("span", {}, t)))
        : null;
      const trackKid = pct < 12 ? el("span", { className: "phase-bar-pct" }, pct + "%") : null;
      const track = el("div", { className: "phase-bar-track" }, fill, trackKid);

      wrap.append(el("div", { className: "phase-row" }, head, track, meta));
    }
  }

  function renderBudget(budget) {
    const wrap = document.getElementById("budget-bars");
    wrap.innerHTML = "";
    const summary = document.getElementById("budget-summary");
    if (!budget || !budget.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune ligne budgétaire."));
      if (summary) summary.textContent = "";
      return;
    }
    let totT = 0, totS = 0;
    for (const b of budget) { totT += b.target_eur || 0; totS += b.spent_eur || 0; }
    if (summary) {
      summary.textContent = `${fmtEur(totS)} / ${fmtEur(totT)}`;
    }
    for (const b of budget) {
      const pct = b.percent_consumed != null ? b.percent_consumed : 0;
      const fillW = Math.max(0, Math.min(100, pct));
      const fillCls = "budget-bar-fill" + (pct > 120 ? " danger" : pct > 100 ? " over" : "");
      const head = el("div", { className: "budget-row-head" },
        el("div", { className: "budget-cat-name" }, b.category),
        el("div", { className: "budget-amounts" },
          el("span", { className: "spent" }, fmtEur(b.spent_eur)),
          " / ",
          fmtEur(b.target_eur)
        ),
      );
      const track = el("div", { className: "budget-bar-track" },
        el("div", { className: fillCls, style: `width:${fillW}%` }),
        el("span", { className: "budget-bar-pct" }, b.percent_consumed != null ? b.percent_consumed + " %" : "—"),
      );
      wrap.append(el("div", { className: "budget-row" }, head, track));
    }
  }

  function renderDecisions(items) {
    const wrap = document.getElementById("dec-cards");
    wrap.innerHTML = "";
    if (!items || !items.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune décision en attente côté famille. 👍"));
      return;
    }
    for (const d of items) {
      wrap.append(el("a", {
        className: "dec-card",
        href: `decisions.html#dec-${d.id}`,
      },
        el("div", { className: "dec-card-id" }, d.id),
        el("div", { className: "dec-card-title" }, d.title),
        d.body_md_preview ? el("div", { className: "dec-card-preview" }, d.body_md_preview) : null,
      ));
    }
  }

  function renderTimeline(activity) {
    const wrap = document.getElementById("timeline");
    const more = document.getElementById("btn-more");
    wrap.innerHTML = "";
    if (!activity || !activity.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune activité récente."));
      if (more) more.hidden = true;
      return;
    }
    const slice = activity.slice(0, state.timelineShown);
    for (const a of slice) {
      const titleNode = a.link
        ? el("a", { href: a.link }, a.title || "(sans titre)")
        : (a.title || "(sans titre)");
      wrap.append(el("div", { className: "timeline-item" },
        el("div", { className: "ti-icon" }, a.icon || "•"),
        el("div", { className: "ti-body" },
          el("div", { className: "ti-title" }, titleNode),
          el("div", { className: "ti-meta" },
            (a.author ? a.author + " · " : "") + fmtDate(a.at, true)),
        ),
        el("div", { className: "ti-time" }, fmtRelative(a.at)),
      ));
    }
    if (more) {
      more.hidden = state.timelineShown >= activity.length;
      more.textContent = `Voir plus (${activity.length - state.timelineShown} restantes)`;
    }
  }

  // ─── Partage WhatsApp ──────────────────────────────────────────────
  function buildShareLines() {
    const d = state.data;
    if (!d) return [];
    const lines = [];
    const k = d.kpis || {};

    lines.push("## KPIs");
    lines.push({ text: `Avancement global : ${k.advancement_pct || 0} %`, bold: true });
    lines.push(`Budget : ${fmtEur(k.budget_consumed_eur)} / ${fmtEur(k.budget_target_eur)}`);
    lines.push(`Décisions famille en attente : ${k.decisions_todo_famille || 0}`);
    lines.push(`Incidents ouverts : ${k.incidents_open || 0}`);
    lines.push(`Phases en cours : ${k.phases_in_progress || 0}`);
    if (k.next_delivery && k.next_delivery.date) {
      lines.push(`Prochaine livraison : ${fmtDate(k.next_delivery.date)} — ${k.next_delivery.supplier || k.next_delivery.order_ref || ""}`);
    }
    lines.push("");

    if (d.phases && d.phases.length) {
      lines.push("## Phases");
      for (const p of d.phases) {
        const pct = Math.round(Number(p.percent_complete) || 0);
        lines.push({
          text: `${p.code ? "[" + p.code + "] " : ""}${p.name} — ${p.status} · ${pct} %`,
          indent: true,
        });
      }
      lines.push("");
    }

    if (d.budget && d.budget.length) {
      lines.push("## Budget par catégorie");
      for (const b of d.budget) {
        const p = b.percent_consumed != null ? b.percent_consumed + " %" : "—";
        lines.push({
          text: `${b.category} : ${fmtEur(b.spent_eur)} / ${fmtEur(b.target_eur)} (${p})`,
          indent: true,
        });
      }
      lines.push("");
    }

    if (d.decisions_todo_famille && d.decisions_todo_famille.length) {
      lines.push("## Décisions famille à trancher");
      for (const dec of d.decisions_todo_famille) {
        lines.push({ text: `[${dec.id}] ${dec.title}`, bold: true, indent: true });
        if (dec.body_md_preview) {
          lines.push({ text: dec.body_md_preview, indent: true, color: "#5a5a5a" });
        }
      }
    }

    return lines;
  }

  async function onShareClick() {
    const btn = document.getElementById("btn-share");
    if (!btn) return;
    if (!window.WhatsappExport) {
      alert("Module d'export non chargé.");
      return;
    }
    if (!state.data) {
      alert("Données non chargées.");
      return;
    }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "⏳ Génération…";
    try {
      const lines = buildShareLines();
      const filename = `chanming-pool-dashboard-${new Date().toISOString().slice(0, 10)}.png`;
      const r = await window.WhatsappExport.exportTextAsImage(
        "Tableau de bord — Chan Ming POOL",
        lines,
        filename
      );
      if (r && r.shared) btn.textContent = "✓ Partagé";
      else if (r && r.downloaded) btn.textContent = "✓ Téléchargé";
      else if (r && r.aborted) btn.textContent = original;
      else btn.textContent = "✓ OK";
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
    } catch (err) {
      console.error("export error", err);
      alert("Erreur lors de l'export : " + (err && err.message || err));
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  // ─── Bind ──────────────────────────────────────────────────────────
  function bind() {
    const btnRefresh = document.getElementById("btn-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", load);
    const btnShare = document.getElementById("btn-share");
    if (btnShare) btnShare.addEventListener("click", onShareClick);
    const btnMore = document.getElementById("btn-more");
    if (btnMore) btnMore.addEventListener("click", () => {
      state.timelineShown += 30;
      renderTimeline(state.data?.activity || []);
    });
  }

  // ─── Init ──────────────────────────────────────────────────────────
  function init() {
    bind();
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
