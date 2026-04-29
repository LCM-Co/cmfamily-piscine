/* Logistique — frontend (suppliers, orders, deliveries, stock + inventory) */
(function () {
  const API = "/api/logistics";

  const ORDER_STATUS_LABEL = {
    draft: "📝 Brouillon", sent: "📤 Envoyée", confirmed: "✓ Confirmée",
    in_transit: "🚛 En transit", customs: "🛂 Douanes",
    delivered: "📦 Livrée", cancelled: "❌ Annulée",
  };
  const DELIVERY_STATUS_LABEL = {
    received: "✅ Reçue OK", partial: "⚠ Partielle",
    rejected: "❌ Refusée", disputed: "⚖ Contestée",
  };
  const STOCK_DIR_LABEL = {
    in: "📥 Entrée", out: "📤 Sortie",
    adjustment: "✏ Ajustement", loss: "🚨 Perte",
  };
  const CATEGORY_ICON = {
    ciment: "🧱", carrelage: "🟦", pierre: "🪨", piscine_pieces: "🚰",
    bois: "🪵", transport: "🚛", main_oeuvre: "👷", electricite: "⚡",
    hydraulique: "💧",
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
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
  }

  function fmtAmount(n, currency) {
    if (n == null) return "—";
    return Number(n).toLocaleString("fr-FR") + " " + (currency || "MGA");
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
    suppliers: document.getElementById("panel-suppliers"),
    orders: document.getElementById("panel-orders"),
    deliveries: document.getElementById("panel-deliveries"),
    stock: document.getElementById("panel-stock"),
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

  // ─── SUPPLIERS ───────────────────────────────────────────────────
  let allSuppliers = [];

  function renderSuppliers() {
    const wrap = document.getElementById("suppliers-list");
    wrap.innerHTML = "";
    if (!allSuppliers.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucun fournisseur. Crée le premier via « ➕ Nouveau fournisseur »."));
      return;
    }
    for (const s of allSuppliers) {
      const card = el("div", { className: "supplier-card", onclick: () => editSupplier(s) },
        el("div", { className: "supplier-head" },
          el("span", { className: "supplier-icon" }, CATEGORY_ICON[s.category] || "📦"),
          el("span", { className: "supplier-name" }, s.name),
          el("span", { className: "supplier-country" }, s.country || ""),
          s.quality_score ? el("span", { className: "quality-score" }, "★".repeat(s.quality_score) + "☆".repeat(5 - s.quality_score)) : null,
        ),
        s.category ? el("div", { className: "supplier-category" }, s.category) : null,
        s.payment_terms ? el("div", { className: "supplier-meta" }, "Paiement : " + s.payment_terms) : null,
        s.notes_md ? el("div", { className: "supplier-notes" }, s.notes_md.slice(0, 200) + (s.notes_md.length > 200 ? "…" : "")) : null,
      );
      wrap.append(card);
    }
    document.getElementById("suppliers-count").textContent = String(allSuppliers.length);
  }

  async function loadSuppliers() {
    try {
      const j = await api("?resource=suppliers");
      allSuppliers = j.suppliers || [];
      renderSuppliers();
    } catch (e) { document.getElementById("suppliers-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`; }
  }
  loaders.suppliers = loadSuppliers;
  loaded.suppliers = true;

  function supplierForm(s) {
    const isNew = !s;
    s = s || {};
    const name = el("input", { type: "text", required: "true", value: s.name || "" });
    const country = el("input", { type: "text", maxlength: "5", value: s.country || "MG", placeholder: "MG, RE, FR, CN…" });
    const category = el("input", { type: "text", value: s.category || "", placeholder: "ciment, carrelage, pierre…" });
    const phone = el("input", { type: "tel", value: s.contact?.phone || "", placeholder: "+261 …" });
    const whatsapp = el("input", { type: "tel", value: s.contact?.whatsapp || "" });
    const email = el("input", { type: "email", value: s.contact?.email || "" });
    const address = el("input", { type: "text", value: s.contact?.address || "" });
    const payment = el("input", { type: "text", value: s.payment_terms || "" });
    const score = el("input", { type: "number", min: "1", max: "5", value: s.quality_score || "" });
    const notes = el("textarea", { rows: 3 }, s.notes_md || "");

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer ce fournisseur ?")) return;
        await api("?resource=suppliers&id=" + encodeURIComponent(s.id), { method: "DELETE" });
        close(); loadSuppliers();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const payload = {
            name: name.value.trim(),
            country: country.value.trim() || "MG",
            category: category.value.trim() || null,
            contact: {
              phone: phone.value.trim() || undefined,
              whatsapp: whatsapp.value.trim() || undefined,
              email: email.value.trim() || undefined,
              address: address.value.trim() || undefined,
            },
            payment_terms: payment.value.trim() || null,
            quality_score: score.value ? parseInt(score.value) : null,
            notes_md: notes.value || null,
          };
          if (isNew) await api("?resource=suppliers", { method: "POST", body: payload });
          else await api("?resource=suppliers&id=" + encodeURIComponent(s.id), { method: "PATCH", body: payload });
          close(); loadSuppliers();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:3fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Nom", name),
        el("label", { className: "dec-field" }, "Pays", country),
      ),
      el("label", { className: "dec-field" }, "Catégorie", category),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Téléphone", phone),
        el("label", { className: "dec-field" }, "WhatsApp", whatsapp),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Email", email),
        el("label", { className: "dec-field" }, "Adresse", address),
      ),
      el("div", { style: "display:grid;grid-template-columns:3fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Conditions paiement", payment),
        el("label", { className: "dec-field" }, "Qualité (1-5)", score),
      ),
      el("label", { className: "dec-field" }, "Notes", notes),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal(isNew ? "🏢 Nouveau fournisseur" : "Fournisseur", form);
    name.focus();
  }

  function editSupplier(s) { supplierForm(s); }
  document.getElementById("btn-new-supplier").addEventListener("click", () => supplierForm(null));

  // ─── ORDERS ──────────────────────────────────────────────────────
  let allOrders = [];

  function renderOrders() {
    const wrap = document.getElementById("orders-list");
    wrap.innerHTML = "";
    if (!allOrders.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune commande. Crée la première via « ➕ Nouvelle commande »."));
      return;
    }
    for (const o of allOrders) {
      const supplier = allSuppliers.find(s => s.id === o.supplier_id);
      const card = el("div", { className: "order-card status-" + o.status, onclick: () => orderForm(o) },
        el("div", { className: "order-head" },
          el("span", { className: "order-status" }, ORDER_STATUS_LABEL[o.status] || o.status),
          el("strong", {}, supplier ? supplier.name : "Fournisseur ?"),
          o.ref_external ? el("span", { className: "order-ref" }, "Réf : " + o.ref_external) : null,
          el("span", { className: "order-amount" }, fmtAmount(o.total_amount, o.total_currency)),
        ),
        el("div", { className: "order-meta" },
          o.ordered_at ? el("span", {}, "Commandée : " + fmtDate(o.ordered_at)) : null,
          o.expected_at ? el("span", {}, " · Attendue : " + fmtDate(o.expected_at)) : null,
        ),
        o.lines?.length ? el("div", { className: "order-lines-summary" },
          `${o.lines.length} ligne${o.lines.length > 1 ? "s" : ""} : ` +
          o.lines.slice(0, 3).map(l => `${l.quantity} ${l.unit} ${l.item}`).join(", ") +
          (o.lines.length > 3 ? "…" : "")
        ) : null,
        o.customs_status ? el("div", { className: "order-customs" }, "🛂 " + o.customs_status) : null,
        o.notes_md ? el("div", { className: "order-notes" }, o.notes_md.slice(0, 180) + (o.notes_md.length > 180 ? "…" : "")) : null,
      );
      wrap.append(card);
    }
    document.getElementById("orders-count").textContent = String(allOrders.length);
  }

  async function loadOrders() {
    try {
      const j = await api("?resource=orders");
      allOrders = j.orders || [];
      if (!allSuppliers.length) await loadSuppliers();
      renderOrders();
    } catch (e) { document.getElementById("orders-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`; }
  }
  loaders.orders = loadOrders;

  function orderForm(o) {
    const isNew = !o;
    o = o || { lines: [], status: "draft", total_currency: "MGA" };

    const supplier = el("select");
    supplier.append(el("option", { value: "" }, "— fournisseur —"));
    for (const s of allSuppliers) supplier.append(el("option", { value: s.id, selected: s.id === o.supplier_id ? "" : null }, s.name));
    const refExt = el("input", { type: "text", value: o.ref_external || "" });
    const orderedAt = el("input", { type: "date", value: o.ordered_at || "" });
    const expectedAt = el("input", { type: "date", value: o.expected_at || "" });
    const status = el("select");
    for (const [k, lbl] of Object.entries(ORDER_STATUS_LABEL)) status.append(el("option", { value: k, selected: k === o.status ? "" : null }, lbl));
    const customs = el("input", { type: "text", value: o.customs_status || "", placeholder: "ex : blocage Tamatave 2026-05-15" });
    const totalAmount = el("input", { type: "number", min: "0", step: "0.01", value: o.total_amount || 0 });
    const totalCurrency = el("select");
    for (const c of ["MGA","EUR","USD"]) totalCurrency.append(el("option", { value: c, selected: c === o.total_currency ? "" : null }, c));
    const notes = el("textarea", { rows: 2 }, o.notes_md || "");

    // Lignes dynamiques
    const linesWrap = el("div", { className: "order-lines-edit" });
    function addLine(line) {
      line = line || { item: "", quantity: 1, unit: "u", unit_price: 0, currency: "MGA", high_risk: false };
      const item = el("input", { type: "text", placeholder: "ex : Ciment Holcim 50 kg", value: line.item, style: "flex:3" });
      const qty = el("input", { type: "number", min: "0", step: "0.01", value: line.quantity, style: "flex:1" });
      const unit = el("input", { type: "text", value: line.unit, style: "flex:1", maxlength: "20" });
      const price = el("input", { type: "number", min: "0", step: "0.01", value: line.unit_price, style: "flex:1" });
      const risk = el("input", { type: "checkbox", checked: line.high_risk ? "" : null, title: "À risque (vol)" });
      const remove = el("button", { type: "button", className: "btn-msg-delete", onclick: () => row.remove() }, "🗑");
      const row = el("div", { className: "line-row", style: "display:flex;gap:6px;align-items:center;margin-bottom:6px;" },
        item, qty, unit, price, el("label", { style: "display:inline-flex;gap:4px;align-items:center;font-size:0.78rem;" }, risk, "🚨"), remove);
      row._get = () => ({
        item: item.value.trim(), quantity: parseFloat(qty.value), unit: unit.value.trim(),
        unit_price: parseFloat(price.value) || 0, currency: totalCurrency.value, high_risk: risk.checked,
      });
      linesWrap.append(row);
    }
    (o.lines || []).forEach(addLine);
    if (!(o.lines || []).length) addLine();

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, isNew ? "Créer" : "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const addLineBtn = el("button", { type: "button", className: "btn btn-secondary", onclick: () => addLine() }, "➕ Ajouter une ligne");
    const error = el("div", { className: "dec-form-error" });
    const delBtn = !isNew ? el("button", { type: "button", className: "btn btn-secondary", style: "color:#a02020;border-color:#f0a0a0",
      onclick: async () => {
        if (!confirm("Supprimer cette commande ?")) return;
        await api("?resource=orders&id=" + encodeURIComponent(o.id), { method: "DELETE" });
        close(); loadOrders();
      } }, "🗑 Supprimer") : null;

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const lines = Array.from(linesWrap.querySelectorAll(".line-row")).map(r => r._get()).filter(l => l.item);
          const payload = {
            supplier_id: supplier.value || null,
            ref_external: refExt.value.trim() || null,
            ordered_at: orderedAt.value || null,
            expected_at: expectedAt.value || null,
            status: status.value,
            customs_status: customs.value.trim() || null,
            total_amount: parseFloat(totalAmount.value) || 0,
            total_currency: totalCurrency.value,
            notes_md: notes.value,
            lines,
          };
          if (isNew) await api("?resource=orders", { method: "POST", body: payload });
          else await api("?resource=orders&id=" + encodeURIComponent(o.id), { method: "PATCH", body: payload });
          close(); loadOrders();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Fournisseur", supplier),
        el("label", { className: "dec-field" }, "Réf externe", refExt),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Date commande", orderedAt),
        el("label", { className: "dec-field" }, "Date attendue", expectedAt),
        el("label", { className: "dec-field" }, "Statut", status),
      ),
      el("label", { className: "dec-field" }, "Statut douane (libre)", customs),
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Montant total", totalAmount),
        el("label", { className: "dec-field" }, "Devise", totalCurrency),
      ),
      el("div", { className: "dec-field" },
        el("strong", {}, "Lignes (item, quantité, unité, prix unitaire, à risque ?)"),
        linesWrap,
        addLineBtn,
      ),
      el("label", { className: "dec-field" }, "Notes", notes),
      error,
      el("div", { className: "dec-form-actions" }, delBtn, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal(isNew ? "📝 Nouvelle commande" : "Commande", form);
  }

  document.getElementById("btn-new-order").addEventListener("click", () => orderForm(null));

  // ─── DELIVERIES ──────────────────────────────────────────────────
  let allDeliveries = [];

  function renderDeliveries() {
    const wrap = document.getElementById("deliveries-list");
    wrap.innerHTML = "";
    if (!allDeliveries.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune livraison enregistrée."));
      return;
    }
    for (const d of allDeliveries) {
      const order = allOrders.find(o => o.id === d.order_id);
      const supplier = order ? allSuppliers.find(s => s.id === order.supplier_id) : null;
      const card = el("div", { className: "delivery-card status-" + d.status },
        el("div", { className: "delivery-head" },
          el("span", { className: "delivery-status" }, DELIVERY_STATUS_LABEL[d.status] || d.status),
          el("span", { className: "delivery-date" }, fmtDate(d.received_at, true)),
          d.received_by ? el("span", { className: "delivery-by" }, "par " + d.received_by) : null,
          el("button", { className: "btn-msg-delete",
            onclick: async () => {
              if (!confirm("Supprimer cette livraison ?")) return;
              await api("?resource=deliveries&id=" + encodeURIComponent(d.id), { method: "DELETE" });
              loadDeliveries();
            } }, "🗑"),
        ),
        order ? el("div", { className: "delivery-order" },
          (supplier ? supplier.name + " · " : "") + (order.ref_external || "Commande sans réf")
        ) : null,
        d.discrepancies_md ? el("div", { className: "delivery-disc" }, "⚠ " + d.discrepancies_md) : null,
      );
      wrap.append(card);
    }
    document.getElementById("deliveries-count").textContent = String(allDeliveries.length);
  }

  async function loadDeliveries() {
    try {
      const j = await api("?resource=deliveries");
      allDeliveries = j.deliveries || [];
      if (!allOrders.length) await loadOrders();
      renderDeliveries();
    } catch (e) { document.getElementById("deliveries-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`; }
  }
  loaders.deliveries = loadDeliveries;

  document.getElementById("btn-new-delivery").addEventListener("click", () => {
    const order = el("select");
    order.append(el("option", { value: "" }, "— commande liée —"));
    for (const o of allOrders) {
      const sup = allSuppliers.find(s => s.id === o.supplier_id);
      order.append(el("option", { value: o.id }, (sup ? sup.name + " · " : "") + (o.ref_external || "(sans réf)")));
    }
    const receivedAt = el("input", { type: "datetime-local", value: new Date().toISOString().slice(0,16), required: "true" });
    const receivedBy = el("input", { type: "text", value: localStorage.getItem("piscine.techAuthor") || "Lennon", maxlength: "60" });
    const status = el("select");
    for (const [k, lbl] of Object.entries(DELIVERY_STATUS_LABEL)) status.append(el("option", { value: k }, lbl));
    const disc = el("textarea", { rows: 2, placeholder: "Écarts vs commande, défauts constatés…" });

    // Stock-in lines (saisie rapide)
    const stockWrap = el("div", { className: "stock-in-edit" });
    function addStock(s) {
      s = s || { item: "", quantity: 0, unit: "u", high_risk: false };
      const item = el("input", { type: "text", placeholder: "Item reçu", value: s.item, style: "flex:3" });
      const qty = el("input", { type: "number", min: "0", step: "0.01", value: s.quantity, style: "flex:1" });
      const unit = el("input", { type: "text", value: s.unit, style: "flex:1", maxlength: "20" });
      const risk = el("input", { type: "checkbox", checked: s.high_risk ? "" : null });
      const rm = el("button", { type: "button", className: "btn-msg-delete", onclick: () => row.remove() }, "🗑");
      const row = el("div", { className: "stock-row", style: "display:flex;gap:6px;margin-bottom:6px;" },
        item, qty, unit, el("label", { style: "display:inline-flex;gap:4px;align-items:center;font-size:0.78rem;" }, risk, "🚨"), rm);
      row._get = () => ({ item: item.value.trim(), quantity: parseFloat(qty.value), unit: unit.value.trim(), high_risk: risk.checked });
      stockWrap.append(row);
    }
    addStock();

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });

    // Pré-remplir depuis la commande sélectionnée
    order.addEventListener("change", () => {
      const o = allOrders.find(x => x.id === order.value);
      if (!o) return;
      stockWrap.innerHTML = "";
      (o.lines || []).forEach(l => addStock({ item: l.item, quantity: l.quantity, unit: l.unit, high_risk: l.high_risk }));
      if (!(o.lines || []).length) addStock();
    });

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const stockIn = Array.from(stockWrap.querySelectorAll(".stock-row")).map(r => r._get()).filter(s => s.item && s.quantity > 0);
          await api("?resource=deliveries", { method: "POST", body: {
            order_id: order.value || null,
            received_at: new Date(receivedAt.value).toISOString(),
            received_by: receivedBy.value.trim(),
            status: status.value,
            discrepancies_md: disc.value || null,
            stock_in: stockIn,
          }});
          localStorage.setItem("piscine.techAuthor", receivedBy.value.trim());
          close();
          loadDeliveries();
          loadOrders();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("label", { className: "dec-field" }, "Commande liée", order),
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Reçu le", receivedAt),
        el("label", { className: "dec-field" }, "Par", receivedBy),
        el("label", { className: "dec-field" }, "Statut", status),
      ),
      el("label", { className: "dec-field" }, "Écarts (optionnel)", disc),
      el("div", { className: "dec-field" },
        el("strong", {}, "Items reçus (entrent en stock)"),
        stockWrap,
        el("button", { type: "button", className: "btn btn-secondary", onclick: () => addStock() }, "➕ Ajouter un item"),
      ),
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal("📦 Nouvelle livraison", form);
  });

  // ─── STOCK ───────────────────────────────────────────────────────
  let allInventory = [], allMovements = [];

  function renderInventory() {
    const wrap = document.getElementById("inventory-list");
    wrap.innerHTML = "";
    if (!allInventory.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucun stock enregistré. Les mouvements alimentent automatiquement l'inventaire."));
      return;
    }
    const table = el("table", { className: "inventory-table" });
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "Item"),
      el("th", {}, "Qté actuelle"),
      el("th", {}, "Entrées"),
      el("th", {}, "Sorties"),
      el("th", {}, "Pertes"),
      el("th", {}, "Dernier mvt"),
    )));
    const tbody = el("tbody");
    for (const i of allInventory) {
      tbody.append(el("tr", { className: i.high_risk ? "high-risk" : "" },
        el("td", {}, (i.high_risk ? "🚨 " : "") + i.item),
        el("td", { className: "qty " + (i.current < 0 ? "negative" : "") }, i.current.toLocaleString("fr-FR") + " " + i.unit),
        el("td", {}, i.in.toLocaleString("fr-FR")),
        el("td", {}, i.out.toLocaleString("fr-FR")),
        el("td", { className: i.loss > 0 ? "loss" : "" }, i.loss.toLocaleString("fr-FR")),
        el("td", {}, fmtDate(i.last_move)),
      ));
    }
    table.append(tbody);
    wrap.append(table);
    document.getElementById("stock-count").textContent = String(allInventory.length);
  }

  function renderMovements() {
    const wrap = document.getElementById("movements-list");
    wrap.innerHTML = "";
    if (!allMovements.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucun mouvement."));
      return;
    }
    for (const m of allMovements) {
      const card = el("div", { className: "movement-card dir-" + m.direction },
        el("span", { className: "mv-dir" }, STOCK_DIR_LABEL[m.direction] || m.direction),
        el("span", { className: "mv-qty" }, m.quantity.toLocaleString("fr-FR") + " " + m.unit),
        el("span", { className: "mv-item" }, (m.high_risk ? "🚨 " : "") + m.item),
        el("span", { className: "mv-date" }, fmtDate(m.recorded_at, true)),
        m.recorded_by ? el("span", { className: "mv-by" }, "par " + m.recorded_by) : null,
        m.notes ? el("span", { className: "mv-notes" }, "— " + m.notes) : null,
        el("button", { className: "btn-msg-delete",
          onclick: async () => {
            if (!confirm("Supprimer ce mouvement ?")) return;
            await api("?resource=stock&id=" + encodeURIComponent(m.id), { method: "DELETE" });
            loadStock();
          } }, "🗑"),
      );
      wrap.append(card);
    }
  }

  async function loadStock() {
    try {
      const [inv, mov] = await Promise.all([
        api("?resource=inventory"),
        api("?resource=stock"),
      ]);
      allInventory = inv.inventory || [];
      allMovements = mov.movements || [];
      renderInventory();
      renderMovements();
    } catch (e) { document.getElementById("inventory-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`; }
  }
  loaders.stock = loadStock;

  document.getElementById("btn-new-movement").addEventListener("click", () => {
    const item = el("input", { type: "text", required: "true", placeholder: "ex : Ciment Holcim 50 kg" });
    const direction = el("select");
    for (const [k, lbl] of Object.entries(STOCK_DIR_LABEL)) direction.append(el("option", { value: k }, lbl));
    const qty = el("input", { type: "number", min: "0", step: "0.01", required: "true", value: "1" });
    const unit = el("input", { type: "text", value: "u", maxlength: "20" });
    const risk = el("input", { type: "checkbox" });
    const recordedBy = el("input", { type: "text", value: localStorage.getItem("piscine.techAuthor") || "Lennon", maxlength: "60" });
    const notes = el("textarea", { rows: 2, placeholder: "Précisions (sortie pour PH04, perte cause vol, ajustement après inventaire…)" });

    const submit = el("button", { type: "submit", className: "btn dec-submit" }, "Enregistrer");
    const cancel = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });

    const form = el("form", { className: "dec-form",
      onsubmit: async ev => {
        ev.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          await api("?resource=stock", { method: "POST", body: {
            item: item.value.trim(), direction: direction.value,
            quantity: parseFloat(qty.value), unit: unit.value.trim() || "u",
            high_risk: risk.checked, recorded_by: recordedBy.value.trim(),
            notes: notes.value || null,
          }});
          close();
          loadStock();
        } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
      }
    },
      el("label", { className: "dec-field" }, "Item", item),
      el("div", { style: "display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;" },
        el("label", { className: "dec-field" }, "Direction", direction),
        el("label", { className: "dec-field" }, "Quantité", qty),
        el("label", { className: "dec-field" }, "Unité", unit),
      ),
      el("div", { style: "display:grid;grid-template-columns:1fr 2fr;gap:10px;" },
        el("label", { className: "dec-field" },
          el("span", {}, "À risque (vol)"),
          el("div", { style: "display:inline-flex;gap:6px;align-items:center;" }, risk, "🚨 ciment, fer, cuivre…")),
        el("label", { className: "dec-field" }, "Par", recordedBy),
      ),
      el("label", { className: "dec-field" }, "Notes", notes),
      error,
      el("div", { className: "dec-form-actions" }, submit, cancel),
    );
    let close;
    cancel.addEventListener("click", () => close());
    close = modal("📊 Nouveau mouvement de stock", form);
    item.focus();
  });

  // ─── Bootstrap ───────────────────────────────────────────────────
  loadSuppliers();
})();
