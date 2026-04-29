/* Chan Ming POOL — Système de prise de décision
   Pour chaque .decision[id^="dec-"] :
     - Charge l'état mutable depuis /api/decisions
     - Met à jour le badge de statut (override HTML)
     - Affiche les boutons d'action selon le statut
     - Affiche le ledger (validation, compléments, rectifications, audit)
     - Ouvre des mini-formulaires pour valider/compléter/rectifier/archiver/rouvrir
   Auth : nom + mot de passe famille mémorisés en localStorage.
*/
(function () {
  const API = "/api/decisions";
  const LS_NAME = "piscine.decAuthor";
  const TIME_FMT = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const STATUS_LABELS = {
    todo:       { tag: "todo",       icon: "🟠", label: "À trancher" },
    discussing: { tag: "discussing", icon: "🔵", label: "En discussion" },
    done:       { tag: "done",       icon: "✅", label: "Validée" },
    archived:   { tag: "archived",   icon: "⛔", label: "Archivée" },
  };

  const ACTION_LABEL = {
    validate:   "✅ Validation",
    complement: "➕ Complément",
    rectify:    "✏️ Rectification",
    archive:    "🗄 Archivage",
    reopen:     "🔄 Réouverture",
  };

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
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

  function fmtDate(iso) {
    try { return TIME_FMT.format(new Date(iso)); } catch { return iso || ""; }
  }

  function getAuthor() {
    return localStorage.getItem(LS_NAME) || "";
  }

  function setAuthor(name) {
    if (name) localStorage.setItem(LS_NAME, name);
  }

  async function fetchAll() {
    try {
      const r = await fetch(API, { headers: { "Accept": "application/json" } });
      if (!r.ok) return {};
      const j = await r.json();
      return j.states || {};
    } catch { return {}; }
  }

  async function postAction(payload) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // ─── Rendu du badge de statut au sommet de la décision ───
  function applyStatusOverride(decisionEl, state) {
    if (!state || !state.status) return;
    const tag = decisionEl.querySelector(".status-tag");
    const meta = STATUS_LABELS[state.status];
    if (!tag || !meta) return;
    tag.className = "status-tag " + meta.tag;
    tag.textContent = `${meta.icon} ${meta.label}`;
    // état CSS sur le wrapper
    decisionEl.classList.remove("is-todo", "is-done", "is-archived");
    if (state.status === "todo" || state.status === "discussing") decisionEl.classList.add("is-todo");
    else if (state.status === "done") decisionEl.classList.add("is-done");
    else if (state.status === "archived") decisionEl.classList.add("is-archived");
  }

  function effectiveStatus(decisionEl, state) {
    if (state && state.status) return state.status;
    if (decisionEl.classList.contains("is-todo")) {
      // distinguer "todo" et "discussing" via le tag déjà présent
      const tag = decisionEl.querySelector(".status-tag");
      if (tag && tag.classList.contains("discussing")) return "discussing";
      return "todo";
    }
    if (decisionEl.classList.contains("is-archived")) return "archived";
    return "done";
  }

  // ─── Ledger : affichage chronologique ───
  function renderLedger(container, state) {
    container.innerHTML = "";
    if (!state) return;
    const hasContent = state.validation || (state.complements?.length) || (state.rectifications?.length) || (state.audit?.length);
    if (!hasContent) {
      container.append(el("p", { className: "ledger-empty" }, "Aucun changement enregistré pour cette décision."));
      return;
    }

    if (state.validation) {
      const v = state.validation;
      container.append(el("div", { className: "ledger-block ledger-validation" },
        el("div", { className: "ledger-head" },
          el("strong", {}, "✅ Validée par " + v.validator),
          el("span", { className: "ledger-date" }, fmtDate(v.date)),
        ),
        v.note ? el("p", { className: "ledger-note" }, v.note) : null,
      ));
    }

    if (state.complements && state.complements.length) {
      const wrap = el("div", { className: "ledger-block ledger-complements" },
        el("h5", {}, "➕ Compléments")
      );
      for (const c of state.complements) {
        wrap.append(el("div", { className: "ledger-item" },
          el("div", { className: "ledger-head" },
            el("strong", {}, c.author),
            el("span", { className: "ledger-date" }, fmtDate(c.date)),
          ),
          el("p", {}, c.text),
        ));
      }
      container.append(wrap);
    }

    if (state.rectifications && state.rectifications.length) {
      const wrap = el("div", { className: "ledger-block ledger-rectifications" },
        el("h5", {}, "✏️ Rectifications")
      );
      for (const r of state.rectifications) {
        wrap.append(el("div", { className: "ledger-item" },
          el("div", { className: "ledger-head" },
            el("strong", {}, `${r.author} · ${r.field}`),
            el("span", { className: "ledger-date" }, fmtDate(r.date)),
          ),
          el("p", { className: "ledger-newvalue" },
            el("strong", {}, "Nouvelle valeur : "),
            r.new_value
          ),
          r.reason ? el("p", { className: "ledger-reason" },
            el("em", {}, "Motif : " + r.reason)
          ) : null,
        ));
      }
      container.append(wrap);
    }

    // Journal d'audit complet (collapsé par défaut)
    if (state.audit && state.audit.length) {
      const auditList = el("ol", { className: "ledger-audit" });
      const sorted = state.audit.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      for (const a of sorted) {
        auditList.append(el("li", {},
          el("strong", {}, ACTION_LABEL[a.action] || a.action),
          " — " + (a.author || "?") + " · ",
          el("span", { className: "ledger-date" }, fmtDate(a.date)),
        ));
      }
      const details = el("details", { className: "ledger-block ledger-auditwrap" },
        el("summary", {}, `📜 Journal complet (${state.audit.length})`),
        auditList,
      );
      container.append(details);
    }
  }

  // ─── Formulaires modaux ───
  function openModal(title, bodyEl) {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: (e) => {
      if (e.target === overlay) close();
    }});
    const modal = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" },
        el("h3", {}, title),
        el("button", { className: "dec-modal-close", "aria-label": "Fermer", onclick: close }, "×"),
      ),
      bodyEl,
    );
    overlay.append(modal);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    function close() {
      overlay.remove();
      document.body.classList.remove("dec-modal-open");
    }
    return { close, overlay };
  }

  function authorField() {
    const nameInput = el("input", {
      type: "text", required: "true", maxlength: "60",
      placeholder: "Ex. : Maman, Papa, Léa…", value: getAuthor(),
    });
    const wrap = el("label", { className: "dec-field dec-field-author" },
      "Votre prénom",
      nameInput,
    );
    return { wrap, nameInput };
  }

  function actionForm({ id, action, title, fields, onSuccess }) {
    const author = authorField();
    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Confirmer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error", "aria-live": "polite" });

    const form = el("form", { className: "dec-form", novalidate: "true" },
      author.wrap,
      ...fields,
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel)
    );

    const { close } = openModal(title, form);
    cancel.addEventListener("click", close);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = "Envoi…";
      error.textContent = "";
      try {
        const name = author.nameInput.value.trim();
        if (!name) throw new Error("Votre prénom est requis");

        const payload = { id, action, author: name };
        for (const f of fields) {
          if (f.dataset && f.dataset.field) {
            const input = f.querySelector("input,textarea,select");
            if (input) payload[f.dataset.field] = input.value;
          }
        }

        const j = await postAction(payload);
        setAuthor(name);
        close();
        if (onSuccess) onSuccess(j.state);
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
        submit.textContent = "Confirmer";
      }
    });
  }

  function field(label, fieldName, opts = {}) {
    const input = opts.textarea
      ? el("textarea", { rows: opts.rows || 4, maxlength: opts.maxlength || 1500, required: opts.required ? "true" : null, placeholder: opts.placeholder || "" })
      : el("input", { type: "text", maxlength: opts.maxlength || 200, required: opts.required ? "true" : null, placeholder: opts.placeholder || "" });
    if (opts.value) input.value = opts.value;
    const wrap = el("label", { className: "dec-field" }, label, input);
    wrap.dataset.field = fieldName;
    return wrap;
  }

  // ─── Construction des boutons d'action selon le statut ───
  function buildActions(decisionEl, id, currentStatus, refresh) {
    const bar = decisionEl.querySelector(".decision-actions") || (() => {
      const b = el("div", { className: "decision-actions" });
      const ledgerEl = decisionEl.querySelector(".decision-ledger");
      if (ledgerEl) decisionEl.insertBefore(b, ledgerEl);
      else decisionEl.append(b);
      return b;
    })();
    bar.innerHTML = "";

    const canValidate = currentStatus === "todo" || currentStatus === "discussing";
    const canComplement = currentStatus !== "archived";
    const canRectify = currentStatus !== "archived";
    const canArchive = currentStatus !== "archived";
    const canReopen = currentStatus === "done" || currentStatus === "archived";

    if (canValidate) {
      bar.append(el("button", {
        className: "dec-action dec-action-validate",
        onclick: () => actionForm({
          id, action: "validate", title: `✅ Valider la décision ${id.replace(/^dec-/, "")}`,
          fields: [
            field("Note de validation (optionnel)", "note", { textarea: true, rows: 3, placeholder: "Ex. : OK pour 2 cabines mixtes avec douche froide." }),
          ],
          onSuccess: (state) => refresh(state),
        }),
      }, "✅ Valider"));
    }

    if (canComplement) {
      bar.append(el("button", {
        className: "dec-action dec-action-complement",
        onclick: () => actionForm({
          id, action: "complement", title: `➕ Ajouter un complément à ${id.replace(/^dec-/, "")}`,
          fields: [
            field("Texte du complément", "text", { textarea: true, rows: 4, required: true, placeholder: "Précision, photo, lien, etc." }),
          ],
          onSuccess: (state) => refresh(state),
        }),
      }, "➕ Compléter"));
    }

    if (canRectify) {
      bar.append(el("button", {
        className: "dec-action dec-action-rectify",
        onclick: () => actionForm({
          id, action: "rectify", title: `✏️ Rectifier la décision ${id.replace(/^dec-/, "")}`,
          fields: [
            field("Quel champ ?", "field", { required: true, placeholder: "Ex. : dimensions, prix, matériau…" }),
            field("Nouvelle valeur", "new_value", { textarea: true, rows: 3, required: true }),
            field("Pourquoi ce changement ?", "reason", { textarea: true, rows: 2 }),
          ],
          onSuccess: (state) => refresh(state),
        }),
      }, "✏️ Rectifier"));
    }

    if (canArchive) {
      bar.append(el("button", {
        className: "dec-action dec-action-archive",
        onclick: () => actionForm({
          id, action: "archive", title: `🗄 Archiver la décision ${id.replace(/^dec-/, "")}`,
          fields: [
            field("Motif de l'archivage", "reason", { textarea: true, rows: 3, placeholder: "Pourquoi cette décision n'est plus pertinente ?" }),
          ],
          onSuccess: (state) => refresh(state),
        }),
      }, "🗄 Archiver"));
    }

    if (canReopen) {
      bar.append(el("button", {
        className: "dec-action dec-action-reopen",
        onclick: () => actionForm({
          id, action: "reopen", title: `🔄 Rouvrir la décision ${id.replace(/^dec-/, "")}`,
          fields: [
            field("Pourquoi rouvrir ?", "reason", { textarea: true, rows: 3 }),
          ],
          onSuccess: (state) => refresh(state),
        }),
      }, "🔄 Rouvrir"));
    }
  }

  // ─── Bootstrap : pour chaque décision, charge l'état et câble les actions ───
  async function init() {
    const allDecisions = Array.from(document.querySelectorAll('.decision[id^="dec-"]'));
    if (!allDecisions.length) return;

    const states = await fetchAll();

    for (const decisionEl of allDecisions) {
      const id = decisionEl.id; // "dec-D31"
      const decId = id.replace(/^dec-/, "");
      const state = states[decId] || null;

      // Préparer le conteneur ledger (placé entre le body et les commentaires)
      let ledgerEl = decisionEl.querySelector(".decision-ledger");
      if (!ledgerEl) {
        ledgerEl = el("div", { className: "decision-ledger" });
        const commentsPanel = decisionEl.querySelector(".comments-panel");
        if (commentsPanel) decisionEl.insertBefore(ledgerEl, commentsPanel);
        else decisionEl.append(ledgerEl);
      }

      const refresh = (newState) => {
        applyStatusOverride(decisionEl, newState);
        renderLedger(ledgerEl, newState);
        const status = effectiveStatus(decisionEl, newState);
        buildActions(decisionEl, decId, status, refresh);
      };

      applyStatusOverride(decisionEl, state);
      renderLedger(ledgerEl, state);
      const status = effectiveStatus(decisionEl, state);
      buildActions(decisionEl, decId, status, refresh);
    }

    // Compteurs en haut de page (action requise) — recalcul si overrides
    updateCounters(states);
  }

  function updateCounters(states) {
    // Recompte les compteurs des bandeaux famille / constructeur d'après l'état Redis
    const decisions = Array.from(document.querySelectorAll('.decision[data-decideur]'));
    const stats = { famille: { todo: 0, discussing: 0, done: 0, archived: 0 },
                    constructeur: { todo: 0, discussing: 0, done: 0, archived: 0 } };
    for (const d of decisions) {
      const decideur = d.dataset.decideur;
      if (!stats[decideur]) continue;
      const id = (d.id || "").replace(/^dec-/, "");
      const override = states[id];
      let st;
      if (override && override.status) st = override.status;
      else st = effectiveStatus(d, null);
      if (stats[decideur][st] === undefined) stats[decideur].discussing++;
      else stats[decideur][st]++;
    }
    const fam = stats.famille;
    const con = stats.constructeur;
    const famLead = document.querySelector(".action-famille .lead");
    if (famLead) {
      famLead.textContent = `${fam.todo} décision${fam.todo > 1 ? "s" : ""} ouverte${fam.todo > 1 ? "s" : ""} — choix d'ambiance, de matériaux, de budget ou de vie quotidienne. Cliquez sur une carte pour voir le détail.`;
    }
    const conLead = document.querySelector(".action-constructeur .lead");
    if (conLead) {
      conLead.textContent = `${con.todo} décision${con.todo > 1 ? "s" : ""} ouverte${con.todo > 1 ? "s" : ""} — structure, hydraulique, électricité, dimensions techniques.`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
