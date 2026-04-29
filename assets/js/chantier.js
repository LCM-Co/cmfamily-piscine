/* Chantier — frontend
   Gère 4 onglets : Phases, Journal, QC, Incidents (+ Photos statique)
   Branché sur /api/chantier.
*/
(function () {
  const API = "/api/chantier";

  const PHASE_STATUS_LABEL = {
    planned:     { icon: "⏳", label: "Planifiée", color: "#5a5a5e" },
    in_progress: { icon: "🚧", label: "En cours",  color: "#a05a00" },
    blocked:     { icon: "⛔", label: "Bloquée",   color: "#a02020" },
    done:        { icon: "✅", label: "Terminée",  color: "#2a5a2a" },
    cancelled:   { icon: "❌", label: "Annulée",   color: "#888" },
  };

  const QC_RESULT_LABEL = {
    pass:    { icon: "✅", label: "OK",     color: "#2a5a2a" },
    fail:    { icon: "❌", label: "ÉCHEC",  color: "#a02020" },
    partial: { icon: "⚠",  label: "Partiel", color: "#a05a00" },
    pending: { icon: "⏳", label: "En attente", color: "#5a5a5e" },
  };

  const INC_TYPE_LABEL = {
    vol: "🚨 Vol",
    accident: "🚑 Accident",
    degat_meteo: "🌪 Dégât météo",
    retard: "⏰ Retard",
    defaut_materiau: "🧱 Défaut matériau",
    conflit: "⚖ Conflit",
    autre: "❓ Autre",
  };

  const INC_SEVERITY_LABEL = {
    low: { icon: "🟢", label: "Faible" },
    medium: { icon: "🟡", label: "Moyen" },
    high: { icon: "🟠", label: "Élevé" },
    critical: { icon: "🔴", label: "Critique" },
  };

  const WEATHER = ["☀ Soleil", "⛅ Variable", "🌧 Pluie", "⛈ Orage", "🌪 Cyclone"];

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "className") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    }
    for (const c of kids) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }

  function escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  function fmtDate(iso, withTime = false) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
  }

  function fmtDay(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" });
  }

  async function api(path, opts = {}) {
    const r = await fetch(API + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // ─── Tabs ─────────────────────────────────────────────────────────
  const tabs = document.querySelectorAll(".tech-tab");
  const panels = {
    phases: document.getElementById("panel-phases"),
    journal: document.getElementById("panel-journal"),
    qc: document.getElementById("panel-qc"),
    incidents: document.getElementById("panel-incidents"),
    photos: document.getElementById("panel-photos"),
  };
  const loaders = {};
  const loaded = {};

  for (const t of tabs) {
    t.addEventListener("click", () => {
      const target = t.dataset.tab;
      tabs.forEach(x => {
        x.classList.toggle("active", x.dataset.tab === target);
        x.setAttribute("aria-selected", x.dataset.tab === target ? "true" : "false");
      });
      Object.entries(panels).forEach(([k, p]) => p.hidden = k !== target);
      if (loaders[target] && !loaded[target]) {
        loaders[target]();
        loaded[target] = true;
      }
    });
  }

  // ─── PHASES ──────────────────────────────────────────────────────
  let allPhases = [];

  function renderPhases() {
    const wrap = document.getElementById("phases-list");
    wrap.innerHTML = "";
    if (!allPhases.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune phase. Crée la première via « ➕ Nouvelle phase »."));
      return;
    }
    for (const p of allPhases) {
      const meta = PHASE_STATUS_LABEL[p.status] || PHASE_STATUS_LABEL.planned;
      const card = el("div", { className: "phase-card status-" + p.status, onclick: () => editPhase(p) },
        el("div", { className: "phase-head" },
          p.code ? el("span", { className: "phase-code" }, p.code) : null,
          el("h3", { className: "phase-title" }, p.name),
          el("span", { className: "phase-status", style: `color:${meta.color}` }, `${meta.icon} ${meta.label}`),
        ),
        el("div", { className: "phase-progress-bar" },
          el("div", { className: "phase-progress-fill", style: `width:${p.percent_complete || 0}%` }),
          el("span", { className: "phase-progress-text" }, `${p.percent_complete || 0} %`),
        ),
        el("div", { className: "phase-dates" },
          el("span", {}, "Prévu : " + fmtDate(p.planned_start) + " → " + fmtDate(p.planned_end)),
          (p.real_start || p.real_end) ? el("span", {}, " · Réel : " + fmtDate(p.real_start) + " → " + fmtDate(p.real_end)) : null,
        ),
        p.body_md ? el("div", { className: "phase-body" }, p.body_md.slice(0, 240) + (p.body_md.length > 240 ? "…" : "")) : null,
      );
      wrap.append(card);
    }
    document.getElementById("phases-count").textContent = String(allPhases.length);
  }

  async function loadPhases() {
    try {
      const j = await api("?resource=phases");
      allPhases = j.phases || [];
      renderPhases();
    } catch (e) {
      document.getElementById("phases-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }
  loaders.phases = loadPhases;
  loaded.phases = true;

  function phaseForm(phase) {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: e => { if (e.target === overlay) close(); } });
    const isNew = !phase;
    const p = phase || { status: "planned", percent_complete: 0, is_public: true };

    const code = el("input", { type: "text", maxlength: "20", placeholder: "PH13", value: p.code || "" });
    const name = el("input", { type: "text", required: "true", maxlength: "200", value: p.name || "" });
    const body = el("textarea", { rows: 4, maxlength: "4000", placeholder: "Description, livrables, vigilances…" }, p.body_md || "");
    const status = el("select");
    for (const [k, m] of Object.entries(PHASE_STATUS_LABEL)) status.append(el("option", { value: k, selected: k === p.status ? "" : null }, m.icon + " " + m.label));
    const pct = el("input", { type: "number", min: "0", max: "100", step: "5", value: p.percent_complete ?? 0 });
    const ps = el("input", { type: "date", value: p.planned_start || "" });
    const pe = el("input", { type: "date", value: p.planned_end || "" });
    const rs = el("input", { type: "date", value: p.real_start || "" });
    const re = el("input", { type: "date", value: p.real_end || "" });

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer définitivement cette phase ?")) return;
        await api("?resource=phases&id=" + encodeURIComponent(phase.id), { method: "DELETE" });
        close();
        loadPhases();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async e => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          const payload = {
            code: code.value.trim(),
            name: name.value.trim(),
            body_md: body.value,
            status: status.value,
            percent_complete: parseInt(pct.value || "0"),
            planned_start: ps.value || null,
            planned_end: pe.value || null,
            real_start: rs.value || null,
            real_end: re.value || null,
          };
          if (isNew) {
            payload.position = (allPhases.length ? Math.max(...allPhases.map(x => x.position || 0)) : 0) + 1;
            await api("?resource=phases", { method: "POST", body: payload });
          } else {
            await api("?resource=phases&id=" + encodeURIComponent(phase.id), { method: "PATCH", body: payload });
          }
          close();
          loadPhases();
        } catch (err) {
          error.textContent = err.message;
        } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:1fr 2fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Code", code),
        el("label", { className: "dec-field" }, "Nom", name),
      ),
      el("label", { className: "dec-field" }, "Description (Markdown)", body),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Statut", status),
        el("label", { className: "dec-field" }, "Avancement (%)", pct),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Début prévu", ps),
        el("label", { className: "dec-field" }, "Fin prévue", pe),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Début réel", rs),
        el("label", { className: "dec-field" }, "Fin réelle", re),
      ),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    cancel.addEventListener("click", close);

    const modal = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" },
        el("h3", {}, isNew ? "➕ Nouvelle phase" : "Phase " + (p.code || "")),
        el("button", { className: "dec-modal-close", onclick: close }, "×")
      ),
      form);
    overlay.append(modal);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    name.focus();
    function close() { overlay.remove(); document.body.classList.remove("dec-modal-open"); }
  }

  function editPhase(p) { phaseForm(p); }
  document.getElementById("btn-new-phase").addEventListener("click", () => phaseForm(null));

  // ─── JOURNAL ─────────────────────────────────────────────────────
  let allLog = [];

  function renderLog() {
    const wrap = document.getElementById("journal-list");
    wrap.innerHTML = "";
    if (!allLog.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune entrée. Crée la première via « ➕ Nouvelle entrée »."));
      return;
    }
    for (const e of allLog) {
      const card = el("div", { className: "log-entry" },
        el("div", { className: "log-head" },
          el("span", { className: "log-date" }, fmtDay(e.log_date)),
          e.weather ? el("span", { className: "log-weather" }, e.weather) : null,
          el("span", { className: "log-author" }, "par " + e.author),
          el("button", { className: "btn-msg-delete",
            onclick: async () => {
              if (!confirm("Supprimer cette entrée ?")) return;
              await api("?resource=sitelog&id=" + encodeURIComponent(e.id), { method: "DELETE" });
              loadLog();
            } }, "🗑"),
        ),
        (e.electricity_outage_h || e.hours_lost_weather) ? el("div", { className: "log-stats" },
          e.electricity_outage_h ? el("span", { className: "stat-pill" }, `⚡ Coupures : ${e.electricity_outage_h} h`) : null,
          e.hours_lost_weather ? el("span", { className: "stat-pill" }, `🌧 Météo : ${e.hours_lost_weather} h perdues`) : null,
        ) : null,
        el("div", { className: "log-body" }, e.body_md),
      );
      wrap.append(card);
    }
    document.getElementById("journal-count").textContent = String(allLog.length);
  }

  async function loadLog() {
    try {
      const j = await api("?resource=sitelog");
      allLog = j.entries || [];
      renderLog();
    } catch (err) {
      document.getElementById("journal-list").innerHTML = `<p class="empty-state">Erreur : ${escape(err.message)}</p>`;
    }
  }
  loaders.journal = loadLog;

  document.getElementById("btn-new-log").addEventListener("click", () => {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: ev => { if (ev.target === overlay) close(); } });
    const date = el("input", { type: "date", value: new Date().toISOString().slice(0,10), required: "true" });
    const author = el("input", { type: "text", value: localStorage.getItem("piscine.techAuthor") || "Lennon", maxlength: "60" });
    const weather = el("select");
    weather.append(el("option", { value: "" }, "— météo —"));
    for (const w of WEATHER) weather.append(el("option", { value: w }, w));
    const outage = el("input", { type: "number", min: "0", step: "0.5", placeholder: "0" });
    const lost = el("input", { type: "number", min: "0", step: "0.5", placeholder: "0" });
    const body = el("textarea", { rows: 5, required: "true", placeholder: "Ce qui a été fait aujourd'hui, problèmes rencontrés, équipe présente…" });

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          await api("?resource=sitelog", { method: "POST", body: {
            log_date: date.value, author: author.value.trim(),
            weather: weather.value || null,
            electricity_outage_h: outage.value ? parseFloat(outage.value) : null,
            hours_lost_weather: lost.value ? parseFloat(lost.value) : null,
            body_md: body.value,
          }});
          localStorage.setItem("piscine.techAuthor", author.value.trim());
          close();
          loadLog();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Date", date),
        el("label", { className: "dec-field" }, "Par", author),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Météo", weather),
        el("label", { className: "dec-field" }, "Coupures élec (h)", outage),
        el("label", { className: "dec-field" }, "Heures perdues météo", lost),
      ),
      el("label", { className: "dec-field" }, "Description", body),
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel),
    );
    cancel.addEventListener("click", close);

    const modal = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" }, el("h3", {}, "📓 Nouvelle entrée du journal"), el("button", { className: "dec-modal-close", onclick: close }, "×")),
      form);
    overlay.append(modal);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    body.focus();
    function close() { overlay.remove(); document.body.classList.remove("dec-modal-open"); }
  });

  // ─── QC ──────────────────────────────────────────────────────────
  let allQc = [];

  function renderQc() {
    const wrap = document.getElementById("qc-list");
    wrap.innerHTML = "";
    if (!allQc.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucun contrôle. Crée le premier via « ➕ Nouveau contrôle »."));
      return;
    }
    for (const q of allQc) {
      const meta = QC_RESULT_LABEL[q.result] || QC_RESULT_LABEL.pending;
      const card = el("div", { className: "qc-card result-" + q.result },
        el("div", { className: "qc-head" },
          el("strong", {}, q.type),
          el("span", { className: "qc-result", style: `color:${meta.color}` }, `${meta.icon} ${meta.label}`),
          el("span", { className: "qc-date" }, fmtDate(q.performed_at, true)),
        ),
        el("div", { className: "qc-meta" },
          q.expected ? el("span", {}, `Attendu : ${q.expected}`) : null,
          q.measured ? el("span", {}, ` · Mesuré : ${q.measured}`) : null,
          q.lab_ref ? el("span", {}, ` · Réf labo : ${q.lab_ref}`) : null,
          q.performer ? el("span", {}, ` · par ${q.performer}`) : null,
        ),
        q.notes_md ? el("div", { className: "qc-notes" }, q.notes_md) : null,
        el("div", { className: "qc-actions" },
          el("button", { className: "btn-msg-delete",
            onclick: async () => {
              if (!confirm("Supprimer ce contrôle ?")) return;
              await api("?resource=qc&id=" + encodeURIComponent(q.id), { method: "DELETE" });
              loadQc();
            } }, "🗑 Supprimer"),
        ),
      );
      wrap.append(card);
    }
    document.getElementById("qc-count").textContent = String(allQc.length);
  }

  async function loadQc() {
    try {
      const j = await api("?resource=qc");
      allQc = j.inspections || [];
      renderQc();
    } catch (e) { document.getElementById("qc-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`; }
  }
  loaders.qc = loadQc;

  document.getElementById("btn-new-qc").addEventListener("click", () => {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: ev => { if (ev.target === overlay) close(); } });
    const type = el("input", { type: "text", required: "true", placeholder: "ex: béton compression 28j", maxlength: "60" });
    const phase = el("select");
    phase.append(el("option", { value: "" }, "— phase liée (optionnel) —"));
    for (const p of allPhases) phase.append(el("option", { value: p.id }, (p.code ? p.code + " · " : "") + p.name));
    const performedAt = el("input", { type: "datetime-local", required: "true", value: new Date().toISOString().slice(0,16) });
    const performer = el("input", { type: "text", maxlength: "60", placeholder: "Labo LNTPB / Entreprise / …" });
    const result = el("select");
    for (const [k, m] of Object.entries(QC_RESULT_LABEL)) result.append(el("option", { value: k }, m.icon + " " + m.label));
    const expected = el("input", { type: "text", placeholder: "ex: ≥ 25 MPa", maxlength: "200" });
    const measured = el("input", { type: "text", placeholder: "ex: 27,3 MPa", maxlength: "200" });
    const labRef = el("input", { type: "text", placeholder: "Réf échantillon", maxlength: "60" });
    const notes = el("textarea", { rows: 3, placeholder: "Notes additionnelles, photos URL, …" });

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          await api("?resource=qc", { method: "POST", body: {
            type: type.value.trim(), phase_id: phase.value || null,
            performed_at: new Date(performedAt.value).toISOString(),
            performer: performer.value.trim(), result: result.value,
            expected: expected.value.trim(), measured: measured.value.trim(),
            lab_ref: labRef.value.trim(), notes_md: notes.value,
          }});
          close();
          loadQc();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("label", { className: "dec-field" }, "Type de contrôle", type),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Phase liée", phase),
        el("label", { className: "dec-field" }, "Résultat", result),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Date contrôle", performedAt),
        el("label", { className: "dec-field" }, "Par (labo / personne)", performer),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Valeur attendue", expected),
        el("label", { className: "dec-field" }, "Valeur mesurée", measured),
      ),
      el("label", { className: "dec-field" }, "Réf labo / éprouvette", labRef),
      el("label", { className: "dec-field" }, "Notes", notes),
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel),
    );
    cancel.addEventListener("click", close);

    const modal = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" }, el("h3", {}, "✅ Nouveau contrôle qualité"), el("button", { className: "dec-modal-close", onclick: close }, "×")),
      form);
    overlay.append(modal);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    type.focus();
    function close() { overlay.remove(); document.body.classList.remove("dec-modal-open"); }
  });

  // ─── INCIDENTS ───────────────────────────────────────────────────
  let allInc = [];

  function renderInc() {
    const wrap = document.getElementById("incidents-list");
    wrap.innerHTML = "";
    if (!allInc.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucun incident. 🎉"));
      return;
    }
    for (const i of allInc) {
      const sev = INC_SEVERITY_LABEL[i.severity] || INC_SEVERITY_LABEL.low;
      const card = el("div", { className: "incident-card sev-" + i.severity + (i.resolved_at ? " resolved" : "") },
        el("div", { className: "incident-head" },
          el("span", { className: "incident-type" }, INC_TYPE_LABEL[i.type] || i.type),
          el("span", { className: "incident-sev" }, sev.icon + " " + sev.label),
          el("span", { className: "incident-date" }, fmtDate(i.occurred_at, true)),
          i.resolved_at ? el("span", { className: "incident-resolved" }, "✓ Résolu") : null,
        ),
        el("div", { className: "incident-body" }, i.body_md),
        i.estimated_cost ? el("div", { className: "incident-cost" }, `Coût estimé : ${i.estimated_cost.toLocaleString("fr-FR")} ${i.estimated_cost_currency}`) : null,
        i.resolution_md ? el("div", { className: "incident-resolution" }, "✓ " + i.resolution_md) : null,
        el("div", { className: "incident-actions" },
          !i.resolved_at ? el("button", { className: "btn-thread-action",
            onclick: async () => {
              const r = prompt("Comment a été résolu cet incident ?");
              if (r === null) return;
              await api("?resource=incidents&id=" + encodeURIComponent(i.id), { method: "PATCH",
                body: { resolution_md: r, resolved_at: new Date().toISOString() } });
              loadInc();
            } }, "✓ Marquer résolu") : null,
          el("button", { className: "btn-msg-delete",
            onclick: async () => {
              if (!confirm("Supprimer cet incident ?")) return;
              await api("?resource=incidents&id=" + encodeURIComponent(i.id), { method: "DELETE" });
              loadInc();
            } }, "🗑"),
        ),
      );
      wrap.append(card);
    }
    document.getElementById("incidents-count").textContent = String(allInc.length);
  }

  async function loadInc() {
    try {
      const j = await api("?resource=incidents");
      allInc = j.incidents || [];
      renderInc();
    } catch (e) { document.getElementById("incidents-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`; }
  }
  loaders.incidents = loadInc;

  document.getElementById("btn-new-incident").addEventListener("click", () => {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: ev => { if (ev.target === overlay) close(); } });
    const type = el("select");
    for (const [k, lbl] of Object.entries(INC_TYPE_LABEL)) type.append(el("option", { value: k }, lbl));
    const severity = el("select");
    for (const [k, m] of Object.entries(INC_SEVERITY_LABEL)) severity.append(el("option", { value: k }, m.icon + " " + m.label));
    const occurred = el("input", { type: "datetime-local", required: "true", value: new Date().toISOString().slice(0,16) });
    const body = el("textarea", { rows: 4, required: "true", placeholder: "Que s'est-il passé ?" });
    const cost = el("input", { type: "number", min: "0", step: "100", placeholder: "0" });
    const currency = el("select");
    for (const c of ["MGA","EUR","USD"]) currency.append(el("option", { value: c }, c));

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          await api("?resource=incidents", { method: "POST", body: {
            type: type.value, severity: severity.value,
            occurred_at: new Date(occurred.value).toISOString(),
            body_md: body.value,
            estimated_cost: cost.value ? parseFloat(cost.value) : null,
            estimated_cost_currency: currency.value,
          }});
          close();
          loadInc();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Type", type),
        el("label", { className: "dec-field" }, "Sévérité", severity),
      ),
      el("label", { className: "dec-field" }, "Date / heure", occurred),
      el("label", { className: "dec-field" }, "Description", body),
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Coût estimé", cost),
        el("label", { className: "dec-field" }, "Devise", currency),
      ),
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel),
    );
    cancel.addEventListener("click", close);

    const modal = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" }, el("h3", {}, "⚠ Nouvel incident"), el("button", { className: "dec-modal-close", onclick: close }, "×")),
      form);
    overlay.append(modal);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    body.focus();
    function close() { overlay.remove(); document.body.classList.remove("dec-modal-open"); }
  });

  // ─── Bootstrap ───────────────────────────────────────────────────
  loadPhases();
})();
