/* Finance — frontend (budget, dépenses, cash flow, paie) */
(function () {
  const API = "/api/finance";
  const LOG_API = "/api/logistics";

  const PAYMENT_LABEL = {
    cash: "💵 Espèces", transfer: "🏦 Virement",
    mobile_money: "📱 Mobile money", check: "🧾 Chèque", other: "⋯ Autre",
  };
  const CATEGORY_ICON = {
    gros_oeuvre: "🧱", second_oeuvre: "🔨", piscine: "🏊", terrasse: "🪨",
    paysager: "🌿", electricite: "⚡", hydraulique: "💧", main_oeuvre: "👷",
    transport: "🚛", divers: "📦", imprevus: "🛟", honoraires: "📐",
    securite: "🔒",
  };

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
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
  }

  function fmtMoney(n, currency) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " " + (currency || "MGA");
  }

  function fmtEur(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
  }

  async function api(base, path, opts = {}) {
    const r = await fetch(base + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const finApi = (p, o) => api(API, p, o);
  const logApi = (p, o) => api(LOG_API, p, o);

  function modal(title, formNode) {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: e => { if (e.target === overlay) close(); } });
    const m = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" },
        el("h3", {}, title),
        el("button", { className: "dec-modal-close", onclick: close }, "×")
      ), formNode);
    overlay.append(m);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    function close() { overlay.remove(); document.body.classList.remove("dec-modal-open"); }
    return close;
  }

  // ─── Tabs ─────────────────────────────────────────────────────────
  const tabs = document.querySelectorAll(".tech-tab");
  const panels = {
    budget: document.getElementById("panel-budget"),
    expenses: document.getElementById("panel-expenses"),
    cashflow: document.getElementById("panel-cashflow"),
    payroll: document.getElementById("panel-payroll"),
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
      if (loaders[target] && !loaded[target]) { loaders[target](); loaded[target] = true; }
    });
  }

  // État partagé
  let allBudget = [], allExpenses = [], allSuppliers = [], allOrders = [];
  let allTeam = [], allAttendance = [];
  let latestFx = null;

  // ─── FX BAR ──────────────────────────────────────────────────────
  async function loadFx() {
    try {
      const j = await finApi("?resource=fxrates");
      latestFx = j.latest;
      const span = document.getElementById("fx-rate");
      if (latestFx) {
        span.textContent = `1 € = ${Number(latestFx.eur_to_mga).toLocaleString("fr-FR")} MGA · 1 $ = ${Number(latestFx.usd_to_mga).toLocaleString("fr-FR")} MGA · ${fmtDate(latestFx.rate_date)}`;
      } else {
        span.textContent = "aucun taux saisi";
      }
    } catch (e) {
      document.getElementById("fx-rate").textContent = "Erreur taux";
    }
  }
  document.getElementById("btn-edit-fx").addEventListener("click", () => fxForm());

  function fxForm() {
    const r = latestFx || {};
    const date = el("input", { type: "date", value: new Date().toISOString().slice(0, 10), required: "true" });
    const eurMga = el("input", { type: "number", min: "0", step: "0.01", value: r.eur_to_mga || "5000", required: "true" });
    const usdMga = el("input", { type: "number", min: "0", step: "0.01", value: r.usd_to_mga || "4500", required: "true" });
    const source = el("input", { type: "text", value: "manuel" });
    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          await finApi("?resource=fxrates", { method: "POST", body: {
            rate_date: date.value, eur_to_mga: parseFloat(eurMga.value),
            usd_to_mga: parseFloat(usdMga.value), source: source.value,
          }});
          close(); loadFx();
        } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
      }
    },
      el("label", { className: "dec-field" }, "Date", date),
      el("label", { className: "dec-field" }, "1 EUR = ? MGA", eurMga),
      el("label", { className: "dec-field" }, "1 USD = ? MGA", usdMga),
      el("label", { className: "dec-field" }, "Source", source),
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal("✏ Taux de change", form);
  }

  // ─── BUDGET ──────────────────────────────────────────────────────
  function renderBudget() {
    const wrap = document.getElementById("budget-list");
    wrap.innerHTML = "";
    if (!allBudget.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune ligne budgétaire. Crée la première via « ➕ Nouvelle ligne »."));
      document.getElementById("budget-count").textContent = "0";
      document.getElementById("budget-summary").innerHTML = "";
      return;
    }

    let totalTargetEur = 0, totalSpentEur = 0;
    for (const l of allBudget) {
      totalTargetEur += l.target_eur || 0;
      totalSpentEur += l.spent_eur || 0;
    }
    const summary = document.getElementById("budget-summary");
    summary.innerHTML = "";
    summary.append(
      el("div", { className: "budget-summary-card" },
        el("span", { className: "ks-label" }, "Total budget"),
        el("span", { className: "ks-value" }, fmtEur(totalTargetEur))),
      el("div", { className: "budget-summary-card" },
        el("span", { className: "ks-label" }, "Total dépensé"),
        el("span", { className: "ks-value" }, fmtEur(totalSpentEur))),
      el("div", { className: "budget-summary-card" },
        el("span", { className: "ks-label" }, "Restant"),
        el("span", { className: "ks-value " + (totalTargetEur - totalSpentEur < 0 ? "negative" : "") }, fmtEur(totalTargetEur - totalSpentEur))),
      el("div", { className: "budget-summary-card" },
        el("span", { className: "ks-label" }, "Consommé"),
        el("span", { className: "ks-value" }, totalTargetEur > 0 ? Math.round((totalSpentEur / totalTargetEur) * 100) + " %" : "—")),
    );

    for (const l of allBudget) {
      const pct = Math.min(200, Math.max(0, l.consumed_pct || 0));
      const pctClass = pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok";
      const card = el("div", { className: "budget-card", onclick: () => budgetForm(l) },
        el("div", { className: "budget-head" },
          el("span", { className: "budget-icon" }, CATEGORY_ICON[l.category] || "📁"),
          el("span", { className: "budget-cat" }, l.category),
          l.subcategory ? el("span", { className: "budget-sub" }, "· " + l.subcategory) : null,
          el("span", { className: "budget-public" }, l.is_public ? "👁 public" : "🔒 privé"),
          el("span", { className: "budget-amount" }, fmtMoney(l.target_amount, l.currency)),
        ),
        el("div", { className: "budget-meta" },
          `Cible : ${fmtEur(l.target_eur)} · Dépensé : ${fmtEur(l.spent_eur)} (${l.expense_count} dépense${l.expense_count > 1 ? "s" : ""}) · Reste : ${fmtEur(l.remaining_eur)}`,
        ),
        el("div", { className: "progress-bar" },
          el("div", { className: "progress-fill " + pctClass, style: `width:${Math.min(100, pct)}%` })),
        el("div", { className: "progress-label" }, Math.round(pct) + " % consommé"),
        l.notes_md ? el("div", { className: "budget-notes" }, l.notes_md.slice(0, 200) + (l.notes_md.length > 200 ? "…" : "")) : null,
      );
      wrap.append(card);
    }
    document.getElementById("budget-count").textContent = String(allBudget.length);
  }

  async function loadBudget() {
    try {
      const j = await finApi("?resource=budget");
      allBudget = j.budget || [];
      if (j.fx) latestFx = j.fx;
      renderBudget();
      // Mettre à jour le filtre poste
      refreshExpenseFilters();
    } catch (e) {
      document.getElementById("budget-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }
  loaders.budget = loadBudget;
  loaded.budget = true;

  function budgetForm(l) {
    const isNew = !l;
    l = l || {};
    const category = el("input", { type: "text", required: "true", value: l.category || "",
      placeholder: "gros_oeuvre, second_oeuvre, piscine, paysager…" });
    const subcategory = el("input", { type: "text", value: l.subcategory || "", placeholder: "ciment, carrelage…" });
    const targetAmount = el("input", { type: "number", min: "0", step: "0.01", value: l.target_amount ?? 0, required: "true" });
    const currency = el("select");
    for (const c of ["MGA","EUR","USD"]) currency.append(el("option", { value: c, selected: c === (l.currency || "MGA") ? "" : null }, c));
    const isPublic = el("input", { type: "checkbox", checked: l.is_public ? "" : null });
    const position = el("input", { type: "number", min: "0", value: l.position ?? 0 });
    const notes = el("textarea", { rows: 3 }, l.notes_md || "");

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer cette ligne budgétaire ? (les dépenses liées seront orphelines)")) return;
        await finApi("?resource=budget&id=" + encodeURIComponent(l.id), { method: "DELETE" });
        close(); loadBudget();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const payload = {
            category: category.value.trim(),
            subcategory: subcategory.value.trim() || null,
            target_amount: parseFloat(targetAmount.value) || 0,
            currency: currency.value,
            is_public: isPublic.checked,
            position: parseInt(position.value) || 0,
            notes_md: notes.value || null,
          };
          if (isNew) await finApi("?resource=budget", { method: "POST", body: payload });
          else await finApi("?resource=budget&id=" + encodeURIComponent(l.id), { method: "PATCH", body: payload });
          close(); loadBudget();
        } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Catégorie", category),
        el("label", { className: "dec-field" }, "Sous-catégorie", subcategory),
      ),
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Montant cible", targetAmount),
        el("label", { className: "dec-field" }, "Devise", currency),
        el("label", { className: "dec-field" }, "Position", position),
      ),
      el("label", { className: "dec-field" },
        el("span", {}, "Visibilité"),
        el("div", { style: "display:inline-flex;gap:6px;align-items:center;" }, isPublic, "👁 public (vue famille)"),
      ),
      el("label", { className: "dec-field" }, "Notes (markdown)", notes),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal(isNew ? "💰 Nouvelle ligne budgétaire" : "Ligne budgétaire", form);
    category.focus();
  }

  document.getElementById("btn-new-budget").addEventListener("click", () => budgetForm(null));

  // ─── EXPENSES ────────────────────────────────────────────────────
  function refreshExpenseFilters() {
    const fb = document.getElementById("filter-budget");
    const cur = fb.value;
    fb.innerHTML = "";
    fb.append(el("option", { value: "" }, "Tous les postes"));
    for (const l of allBudget) {
      const lbl = l.category + (l.subcategory ? " / " + l.subcategory : "");
      fb.append(el("option", { value: l.id, selected: cur === l.id ? "" : null }, lbl));
    }
    const fs = document.getElementById("filter-supplier");
    const curS = fs.value;
    fs.innerHTML = "";
    fs.append(el("option", { value: "" }, "Tous fournisseurs"));
    for (const s of allSuppliers) {
      fs.append(el("option", { value: s.id, selected: curS === s.id ? "" : null }, s.name));
    }
  }

  function getFilteredExpenses() {
    const fb = document.getElementById("filter-budget").value;
    const fs = document.getElementById("filter-supplier").value;
    const fm = document.getElementById("filter-mode").value;
    return allExpenses.filter(e => {
      if (fb && e.budget_line_id !== fb) return false;
      if (fs && e.supplier_id !== fs) return false;
      if (fm && e.payment_mode !== fm) return false;
      return true;
    });
  }

  function renderExpenses() {
    const wrap = document.getElementById("expenses-list");
    wrap.innerHTML = "";
    const list = getFilteredExpenses();
    if (!list.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune dépense ne correspond aux filtres."));
      document.getElementById("expenses-count").textContent = String(allExpenses.length);
      return;
    }
    for (const e of list) {
      const line = allBudget.find(b => b.id === e.budget_line_id);
      const supplier = allSuppliers.find(s => s.id === e.supplier_id);
      const order = allOrders.find(o => o.id === e.order_id);
      const eur = e.fx_rate_to_eur && e.amount
        ? Number(e.amount) / Number(e.fx_rate_to_eur)
        : (e.currency === "EUR" ? Number(e.amount) : null);
      const card = el("div", { className: "expense-card mode-" + e.payment_mode, onclick: () => expenseForm(e) },
        el("div", { className: "expense-head" },
          el("span", { className: "expense-mode" }, PAYMENT_LABEL[e.payment_mode] || e.payment_mode),
          el("span", { className: "expense-date" }, fmtDate(e.paid_at)),
          line ? el("span", { className: "expense-line" }, line.category + (line.subcategory ? " / " + line.subcategory : "")) : el("span", { className: "expense-line orphan" }, "(sans poste)"),
          el("span", { className: "expense-amount" }, fmtMoney(e.amount, e.currency) + (eur != null && e.currency !== "EUR" ? ` ≈ ${fmtEur(eur)}` : "")),
        ),
        el("div", { className: "expense-meta" },
          supplier ? el("span", {}, "Fournisseur : " + supplier.name) : null,
          order ? el("span", {}, " · Commande : " + (order.ref_external || order.id.slice(0, 6))) : null,
          e.validated_by_2nd ? el("span", { className: "expense-valid" }, " · ✓ validé par " + e.validated_by_2nd) : null,
          e.receipt_url ? el("a", { href: e.receipt_url, target: "_blank", rel: "noopener", className: "expense-receipt", onclick: ev => ev.stopPropagation() }, " · 📎 reçu") : null,
        ),
        e.description ? el("div", { className: "expense-desc" }, e.description) : null,
      );
      wrap.append(card);
    }
    document.getElementById("expenses-count").textContent = String(allExpenses.length);
  }

  async function loadExpenses() {
    try {
      const promises = [finApi("?resource=expenses")];
      if (!allBudget.length) promises.push(finApi("?resource=budget"));
      if (!allSuppliers.length) promises.push(logApi("?resource=suppliers"));
      if (!allOrders.length) promises.push(logApi("?resource=orders"));
      const results = await Promise.all(promises);
      allExpenses = results[0].expenses || [];
      let i = 1;
      if (!allBudget.length && results[i]) { allBudget = results[i].budget || []; i++; }
      if (!allSuppliers.length && results[i]) { allSuppliers = results[i].suppliers || []; i++; }
      if (!allOrders.length && results[i]) { allOrders = results[i].orders || []; i++; }
      refreshExpenseFilters();
      renderExpenses();
    } catch (e) {
      document.getElementById("expenses-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }
  loaders.expenses = loadExpenses;

  ["filter-budget", "filter-supplier", "filter-mode"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderExpenses);
  });

  function expenseForm(e) {
    const isNew = !e;
    e = e || { paid_at: new Date().toISOString().slice(0, 10), currency: "MGA", payment_mode: "cash" };

    const budgetLine = el("select");
    budgetLine.append(el("option", { value: "" }, "— sans poste —"));
    for (const l of allBudget) {
      const lbl = l.category + (l.subcategory ? " / " + l.subcategory : "");
      budgetLine.append(el("option", { value: l.id, selected: l.id === e.budget_line_id ? "" : null }, lbl));
    }
    const amount = el("input", { type: "number", min: "0", step: "0.01", value: e.amount ?? "", required: "true" });
    const currency = el("select");
    for (const c of ["MGA","EUR","USD"]) currency.append(el("option", { value: c, selected: c === e.currency ? "" : null }, c));
    const fxRate = el("input", { type: "number", min: "0", step: "0.0001", value: e.fx_rate_to_eur ?? "",
      placeholder: "auto via taux du jour" });
    const paidAt = el("input", { type: "date", value: e.paid_at ? String(e.paid_at).slice(0, 10) : "", required: "true" });
    const paymentMode = el("select");
    for (const [k, lbl] of Object.entries(PAYMENT_LABEL)) paymentMode.append(el("option", { value: k, selected: k === e.payment_mode ? "" : null }, lbl));
    const supplier = el("select");
    supplier.append(el("option", { value: "" }, "—"));
    for (const s of allSuppliers) supplier.append(el("option", { value: s.id, selected: s.id === e.supplier_id ? "" : null }, s.name));
    const order = el("select");
    order.append(el("option", { value: "" }, "—"));
    for (const o of allOrders) {
      const sup = allSuppliers.find(s => s.id === o.supplier_id);
      order.append(el("option", { value: o.id, selected: o.id === e.order_id ? "" : null },
        (sup ? sup.name + " · " : "") + (o.ref_external || "(sans réf)")));
    }
    const description = el("textarea", { rows: 2 }, e.description || "");
    const receiptUrl = el("input", { type: "url", value: e.receipt_url || "", placeholder: "https://… (lien photo reçu)" });
    const validatedBy2nd = el("input", { type: "text", value: e.validated_by_2nd || "", maxlength: "60",
      placeholder: "ex : Aina (témoin paiement cash)" });
    const isPublic = el("input", { type: "checkbox", checked: e.is_public ? "" : null });

    const cashHint = el("div", { className: "dec-form-hint", style: "display:none" },
      "🚨 Dépense espèces > 100 000 MGA — un témoin (validated_by_2nd) est obligatoire.");

    function updateCashHint() {
      const amtMga = parseFloat(amount.value) || 0;
      let mga = amtMga;
      if (currency.value === "EUR" && latestFx?.eur_to_mga) mga = amtMga * latestFx.eur_to_mga;
      else if (currency.value === "USD" && latestFx?.usd_to_mga) mga = amtMga * latestFx.usd_to_mga;
      cashHint.style.display = (paymentMode.value === "cash" && mga > 100000) ? "block" : "none";
    }
    [amount, currency, paymentMode].forEach(i => i.addEventListener("input", updateCashHint));
    [amount, currency, paymentMode].forEach(i => i.addEventListener("change", updateCashHint));
    setTimeout(updateCashHint, 0);

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer cette dépense ?")) return;
        await finApi("?resource=expenses&id=" + encodeURIComponent(e.id), { method: "DELETE" });
        close(); loadExpenses(); loadBudget();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const payload = {
            budget_line_id: budgetLine.value || null,
            amount: parseFloat(amount.value),
            currency: currency.value,
            fx_rate_to_eur: fxRate.value ? parseFloat(fxRate.value) : null,
            paid_at: paidAt.value || null,
            payment_mode: paymentMode.value,
            supplier_id: supplier.value || null,
            order_id: order.value || null,
            description: description.value.trim() || null,
            validated_by_2nd: validatedBy2nd.value.trim() || null,
            receipt_url: receiptUrl.value.trim() || null,
            is_public: isPublic.checked,
          };
          if (isNew) await finApi("?resource=expenses", { method: "POST", body: payload });
          else await finApi("?resource=expenses&id=" + encodeURIComponent(e.id), { method: "PATCH", body: payload });
          close(); loadExpenses(); loadBudget();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("label", { className: "dec-field" }, "Poste budgétaire", budgetLine),
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Montant", amount),
        el("label", { className: "dec-field" }, "Devise", currency),
        el("label", { className: "dec-field" }, "Date paiement", paidAt),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Mode paiement", paymentMode),
        el("label", { className: "dec-field" }, "Taux EUR (auto si vide)", fxRate),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Fournisseur", supplier),
        el("label", { className: "dec-field" }, "Commande liée", order),
      ),
      el("label", { className: "dec-field" }, "Description", description),
      el("label", { className: "dec-field" }, "URL reçu (photo)", receiptUrl),
      el("label", { className: "dec-field" }, "Validé par (2e personne)", validatedBy2nd),
      cashHint,
      el("label", { className: "dec-field" },
        el("span", {}, "Visibilité"),
        el("div", { style: "display:inline-flex;gap:6px;align-items:center;" }, isPublic, "👁 public"),
      ),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal(isNew ? "💳 Nouvelle dépense" : "Dépense", form);
    amount.focus();
  }

  document.getElementById("btn-new-expense").addEventListener("click", () => expenseForm(null));

  // ─── CASH FLOW ───────────────────────────────────────────────────
  async function loadCashflow() {
    try {
      const j = await finApi("?resource=summary");
      renderCashflow(j);
    } catch (e) {
      document.getElementById("cashflow-bars").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }
  loaders.cashflow = loadCashflow;

  function renderCashflow(j) {
    const k = j.kpis || {};
    const wrapKpi = document.getElementById("cashflow-kpis");
    wrapKpi.innerHTML = "";
    wrapKpi.append(
      el("div", { className: "kpi-card" },
        el("span", { className: "kpi-label" }, "Budget total"),
        el("span", { className: "kpi-value" }, fmtEur(k.total_budget_eur))),
      el("div", { className: "kpi-card" },
        el("span", { className: "kpi-label" }, "Dépensé total"),
        el("span", { className: "kpi-value" }, fmtEur(k.total_spent_eur))),
      el("div", { className: "kpi-card" },
        el("span", { className: "kpi-label" }, "Restant"),
        el("span", { className: "kpi-value " + (k.remaining_eur < 0 ? "negative" : "") }, fmtEur(k.remaining_eur))),
      el("div", { className: "kpi-card" },
        el("span", { className: "kpi-label" }, "Consommé"),
        el("span", { className: "kpi-value" }, Math.round(k.consumed_pct || 0) + " %")),
    );

    // Bars 12 mois
    const bars = document.getElementById("cashflow-bars");
    bars.innerHTML = "";
    const months = j.months || [];
    const max = Math.max(1, ...months.map(m => m.total_eur || 0));
    for (const m of months) {
      const w = max > 0 ? (m.total_eur / max) * 100 : 0;
      bars.append(el("div", { className: "month-row" },
        el("span", { className: "month-label" }, m.label),
        el("div", { className: "month-bar-wrap" },
          el("div", { className: "month-bar", style: `width:${w}%` })),
        el("span", { className: "month-value" }, fmtEur(m.total_eur)),
        el("span", { className: "month-cum" }, "cum: " + fmtEur(m.cumulative_eur)),
      ));
    }
    if (!months.length) bars.append(el("p", { className: "empty-state" }, "Aucune donnée."));

    // Camembert paiement (CSS conic-gradient)
    const pie = document.getElementById("cashflow-pie");
    pie.innerHTML = "";
    const total = (k.cash_eur || 0) + (k.transfer_eur || 0) + (k.other_eur || 0);
    if (total > 0) {
      const cashPct = (k.cash_eur / total) * 100;
      const trPct = (k.transfer_eur / total) * 100;
      const offset1 = cashPct;
      const offset2 = cashPct + trPct;
      const gradient = `conic-gradient(#d18a3a 0 ${offset1}%, #4a6a9a ${offset1}% ${offset2}%, #888 ${offset2}% 100%)`;
      pie.append(
        el("div", { className: "pie-chart", style: `background:${gradient}` }),
        el("div", { className: "pie-legend" },
          el("div", {}, el("span", { className: "swatch", style: "background:#d18a3a" }), "💵 Espèces : ", fmtEur(k.cash_eur), ` (${Math.round(cashPct)} %)`),
          el("div", {}, el("span", { className: "swatch", style: "background:#4a6a9a" }), "🏦 Virement : ", fmtEur(k.transfer_eur), ` (${Math.round(trPct)} %)`),
          el("div", {}, el("span", { className: "swatch", style: "background:#888" }), "⋯ Autre : ", fmtEur(k.other_eur), ` (${Math.round(100 - cashPct - trPct)} %)`),
        ),
      );
    } else {
      pie.append(el("p", { className: "empty-state" }, "Aucune dépense enregistrée."));
    }

    // Catégories
    const cats = document.getElementById("cashflow-cats");
    cats.innerHTML = "";
    const list = j.by_category || [];
    if (!list.length) {
      cats.append(el("p", { className: "empty-state" }, "Aucune catégorie."));
      return;
    }
    const maxC = Math.max(1, ...list.map(c => Math.max(c.target_eur, c.spent_eur)));
    for (const c of list) {
      const tw = (c.target_eur / maxC) * 100;
      const sw = (c.spent_eur / maxC) * 100;
      const pct = c.target_eur > 0 ? (c.spent_eur / c.target_eur) * 100 : 0;
      cats.append(el("div", { className: "cat-row" },
        el("div", { className: "cat-name" }, (CATEGORY_ICON[c.category] || "📁") + " " + c.category),
        el("div", { className: "cat-bars" },
          el("div", { className: "cat-bar target", style: `width:${tw}%`, title: "Cible : " + fmtEur(c.target_eur) }),
          el("div", { className: "cat-bar spent " + (pct > 100 ? "over" : ""), style: `width:${sw}%`, title: "Dépensé : " + fmtEur(c.spent_eur) }),
        ),
        el("div", { className: "cat-meta" }, `${fmtEur(c.spent_eur)} / ${fmtEur(c.target_eur)} (${Math.round(pct)} %)`),
      ));
    }
  }

  // ─── PAYROLL ─────────────────────────────────────────────────────
  function monthBounds(d = new Date()) {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      label: start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    };
  }

  async function loadPayroll() {
    try {
      const b = monthBounds();
      const [t, a] = await Promise.all([
        finApi("?resource=team"),
        finApi(`?resource=attendance&from=${b.from}&to=${b.to}`),
      ]);
      allTeam = t.team || [];
      allAttendance = a.attendance || [];
      renderPayroll();
    } catch (e) {
      document.getElementById("payroll-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }
  loaders.payroll = loadPayroll;

  function renderPayroll() {
    const b = monthBounds();
    const head = document.getElementById("payroll-month");
    head.innerHTML = "";

    let grandTotal = 0, grandPaid = 0;
    const byMember = {};
    for (const a of allAttendance) {
      if (!byMember[a.member_id]) byMember[a.member_id] = { hours: 0, paid: 0, days: 0, entries: [] };
      byMember[a.member_id].hours += Number(a.hours) || 0;
      byMember[a.member_id].days++;
      byMember[a.member_id].paid += Number(a.amount_paid_mga) || 0;
      byMember[a.member_id].entries.push(a);
    }
    for (const m of allTeam) {
      const x = byMember[m.id];
      if (!x) continue;
      const due = (x.hours / 8) * Number(m.daily_rate_mga || 0);
      grandTotal += due;
      grandPaid += x.paid;
    }
    head.append(
      el("div", { className: "payroll-month-card" },
        el("h3", {}, "Paie · " + b.label),
        el("div", { className: "payroll-totals" },
          el("span", {}, "À payer : ", el("strong", {}, fmtMoney(grandTotal, "MGA"))),
          el("span", {}, " · Payé : ", el("strong", {}, fmtMoney(grandPaid, "MGA"))),
          el("span", {}, " · Reste : ", el("strong", { className: grandTotal - grandPaid > 0 ? "negative" : "" }, fmtMoney(Math.max(0, grandTotal - grandPaid), "MGA"))),
        )));

    const wrap = document.getElementById("payroll-list");
    wrap.innerHTML = "";
    if (!allTeam.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucun équipier. Crée le premier via « ➕ Nouvel équipier »."));
      document.getElementById("team-count").textContent = "0";
      return;
    }
    for (const m of allTeam) {
      const x = byMember[m.id] || { hours: 0, paid: 0, days: 0, entries: [] };
      const due = (x.hours / 8) * Number(m.daily_rate_mga || 0);
      const remaining = Math.max(0, due - x.paid);
      const card = el("div", { className: "team-card " + (m.active ? "" : "inactive") },
        el("div", { className: "team-head" },
          el("span", { className: "team-name", onclick: () => memberForm(m) }, m.name),
          m.role ? el("span", { className: "team-role" }, m.role) : null,
          el("span", { className: "team-rate" }, fmtMoney(m.daily_rate_mga, "MGA") + "/j"),
          el("span", { className: "team-status" }, m.active ? "✓ actif" : "⏸ inactif"),
        ),
        el("div", { className: "team-stats" },
          el("span", {}, x.days + " jour" + (x.days > 1 ? "s" : "") + " · " + x.hours.toFixed(1) + " h"),
          el("span", {}, "À payer : ", el("strong", {}, fmtMoney(due, "MGA"))),
          el("span", {}, "Payé : ", el("strong", {}, fmtMoney(x.paid, "MGA"))),
          el("span", { className: remaining > 0 ? "remaining" : "" }, "Reste : " + fmtMoney(remaining, "MGA")),
        ),
        x.entries.length ? attendanceTable(x.entries, m) : el("p", { className: "hint" }, "Aucune présence ce mois-ci."),
      );
      wrap.append(card);
    }
    document.getElementById("team-count").textContent = String(allTeam.filter(m => m.active).length);
  }

  function attendanceTable(entries, member) {
    const sorted = entries.slice().sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
    const table = el("table", { className: "attendance-table" });
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "Date"), el("th", {}, "Heures"),
      el("th", {}, "À payer"), el("th", {}, "Payé"), el("th", {}, "Mode"), el("th", {}, ""),
    )));
    const tbody = el("tbody");
    for (const a of sorted) {
      const due = (Number(a.hours) / 8) * Number(member.daily_rate_mga || 0);
      tbody.append(el("tr", {},
        el("td", {}, fmtDate(a.attendance_date)),
        el("td", {}, (Number(a.hours) || 0).toFixed(1)),
        el("td", {}, fmtMoney(due, "MGA")),
        el("td", { className: a.paid_at ? "paid" : "unpaid" }, a.amount_paid_mga ? fmtMoney(a.amount_paid_mga, "MGA") : "—"),
        el("td", {}, a.payment_mode ? PAYMENT_LABEL[a.payment_mode] : "—"),
        el("td", {}, el("button", { className: "btn-msg-delete", onclick: () => attendanceForm(a, member) }, "✏")),
      ));
    }
    table.append(tbody);
    return table;
  }

  function memberForm(m) {
    const isNew = !m;
    m = m || { active: true };
    const name = el("input", { type: "text", required: "true", value: m.name || "" });
    const role = el("input", { type: "text", value: m.role || "", placeholder: "maçon, chef d'équipe, plombier…" });
    const rate = el("input", { type: "number", min: "0", step: "1000", value: m.daily_rate_mga ?? 0, required: "true" });
    const phone = el("input", { type: "tel", value: m.contact?.phone || "" });
    const active = el("input", { type: "checkbox", checked: m.active === false ? null : "" });
    const notes = el("textarea", { rows: 2 }, m.notes || "");

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer cet équipier ? (les présences liées seront supprimées en cascade)")) return;
        await finApi("?resource=team&id=" + encodeURIComponent(m.id), { method: "DELETE" });
        close(); loadPayroll();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const payload = {
            name: name.value.trim(),
            role: role.value.trim() || null,
            daily_rate_mga: parseFloat(rate.value) || 0,
            contact: { phone: phone.value.trim() || undefined },
            active: active.checked,
            notes: notes.value || null,
          };
          if (isNew) await finApi("?resource=team", { method: "POST", body: payload });
          else await finApi("?resource=team&id=" + encodeURIComponent(m.id), { method: "PATCH", body: payload });
          close(); loadPayroll();
        } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Nom", name),
        el("label", { className: "dec-field" }, "Rôle", role),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Taux journalier MGA (8 h)", rate),
        el("label", { className: "dec-field" }, "Téléphone", phone),
      ),
      el("label", { className: "dec-field" },
        el("span", {}, "Statut"),
        el("div", { style: "display:inline-flex;gap:6px;align-items:center;" }, active, "Actif sur le chantier"),
      ),
      el("label", { className: "dec-field" }, "Notes", notes),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal(isNew ? "👷 Nouvel équipier" : "Équipier", form);
    name.focus();
  }

  document.getElementById("btn-new-member").addEventListener("click", () => memberForm(null));

  function attendanceForm(a, lockedMember) {
    const isNew = !a;
    a = a || { hours: 8, attendance_date: new Date().toISOString().slice(0, 10) };

    const member = el("select");
    if (lockedMember) {
      member.append(el("option", { value: lockedMember.id, selected: "" }, lockedMember.name));
      member.disabled = true;
    } else {
      for (const m of allTeam.filter(x => x.active)) {
        member.append(el("option", { value: m.id, selected: m.id === a.member_id ? "" : null }, m.name + " (" + m.daily_rate_mga + " MGA/j)"));
      }
    }
    const date = el("input", { type: "date", required: "true", value: a.attendance_date });
    const hours = el("input", { type: "number", min: "0", max: "16", step: "0.5", value: a.hours ?? 8, required: "true" });
    const paidAt = el("input", { type: "date", value: a.paid_at ? String(a.paid_at).slice(0, 10) : "" });
    const amountPaid = el("input", { type: "number", min: "0", step: "100", value: a.amount_paid_mga ?? "" });
    const paymentMode = el("select");
    paymentMode.append(el("option", { value: "" }, "—"));
    for (const [k, lbl] of Object.entries(PAYMENT_LABEL)) paymentMode.append(el("option", { value: k, selected: k === a.payment_mode ? "" : null }, lbl));
    const notes = el("textarea", { rows: 2 }, a.notes || "");

    // Suggérer montant si vide
    function suggestAmount() {
      if (amountPaid.value) return;
      const m = lockedMember || allTeam.find(x => x.id === member.value);
      if (!m) return;
      const due = (parseFloat(hours.value) / 8) * Number(m.daily_rate_mga || 0);
      amountPaid.placeholder = "suggéré : " + Math.round(due);
    }
    [member, hours].forEach(i => i.addEventListener("change", suggestAmount));
    suggestAmount();

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer cette présence ?")) return;
        await finApi("?resource=attendance&id=" + encodeURIComponent(a.id), { method: "DELETE" });
        close(); loadPayroll();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const payload = {
            member_id: lockedMember ? lockedMember.id : member.value,
            attendance_date: date.value,
            hours: parseFloat(hours.value),
            paid_at: paidAt.value || null,
            payment_mode: paymentMode.value || null,
            amount_paid_mga: amountPaid.value ? parseFloat(amountPaid.value) : null,
            notes: notes.value || null,
          };
          if (isNew || (a.member_id && payload.member_id === a.member_id && payload.attendance_date === a.attendance_date)) {
            // POST utilise upsert (member_id, attendance_date)
            if (a.id && !isNew) {
              await finApi("?resource=attendance&id=" + encodeURIComponent(a.id), { method: "PATCH", body: payload });
            } else {
              await finApi("?resource=attendance", { method: "POST", body: payload });
            }
          } else {
            await finApi("?resource=attendance", { method: "POST", body: payload });
          }
          close(); loadPayroll();
        } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Équipier", member),
        el("label", { className: "dec-field" }, "Date", date),
        el("label", { className: "dec-field" }, "Heures", hours),
      ),
      el("h4", { style: "margin:1em 0 0;font-size:1rem;" }, "Paiement (optionnel)"),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Date paiement", paidAt),
        el("label", { className: "dec-field" }, "Montant payé MGA", amountPaid),
        el("label", { className: "dec-field" }, "Mode", paymentMode),
      ),
      el("label", { className: "dec-field" }, "Notes", notes),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal(isNew ? "⏱ Saisie présence" : "Présence", form);
  }

  document.getElementById("btn-quick-attendance").addEventListener("click", () => {
    if (!allTeam.length) { alert("Crée d'abord un équipier."); return; }
    attendanceForm(null, null);
  });

  // ─── Bootstrap ───────────────────────────────────────────────────
  loadFx();
  loadBudget();
})();
