/* Chan Ming POOL — Système de commentaires natif
   Cherche tous les éléments [data-comments="<decision-id>"] et y injecte :
     - liste des commentaires existants
     - formulaire (nom, message, statut optionnel, honeypot)
   Stockage côté serveur via /api/comments (Vercel + Upstash Redis).
   Si l'API n'est pas configurée, message d'erreur clair, fallback localStorage en mode lecture seule visuelle.
*/
(function() {
  const API = "/api/comments";
  const TIME_FMT = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[c]));
  }

  function formatDate(iso) {
    try { return TIME_FMT.format(new Date(iso)); }
    catch { return iso; }
  }

  function statusLabel(s) {
    return ({
      "en-cours": "En cours",
      "a-discuter": "À discuter",
      "prise": "Prête à être prise",
    })[s] || null;
  }

  async function fetchComments(decision) {
    const r = await fetch(`${API}?decision=${encodeURIComponent(decision)}`, {
      headers: { "Accept": "application/json" }
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    return r.json();
  }

  async function postComment(payload) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    return r.json();
  }

  function renderTally(tally, container) {
    if (!tally) return;
    container.innerHTML = "";
    const total = (tally["en-cours"] || 0) + (tally["a-discuter"] || 0) + (tally["prise"] || 0);
    if (total === 0) {
      container.append(el("span", { className: "tally-empty" }, "Aucun avis pour le moment"));
      return;
    }
    const items = [
      { key: "en-cours", label: "En cours", color: "#d18a3a" },
      { key: "a-discuter", label: "À discuter", color: "#a05a8a" },
      { key: "prise", label: "Prête", color: "#3a7a4a" },
    ];
    for (const it of items) {
      const n = tally[it.key] || 0;
      const chip = el("span", { className: "tally-chip", style: `border-color:${it.color};color:${it.color}` },
        `${it.label} · ${n}`);
      container.append(chip);
    }
  }

  function renderComment(c) {
    const node = el("div", { className: "comment-item" });
    const header = el("div", { className: "comment-head" });
    header.append(el("strong", {}, c.name || "Anonyme"));
    if (c.status) {
      header.append(el("span", { className: `comment-status status-${c.status}` }, statusLabel(c.status)));
    }
    header.append(el("span", { className: "comment-date" }, formatDate(c.created_at)));
    node.append(header);
    const body = el("div", { className: "comment-body" });
    body.innerHTML = escape(c.body).replace(/\n/g, "<br>");
    node.append(body);
    return node;
  }

  function makeForm(decision, onSuccess) {
    const form = el("form", { className: "comment-form" });
    form.append(
      el("div", { className: "row" },
        el("input", { type: "text", name: "name", placeholder: "Votre prénom", required: "required", maxlength: "60" }),
      ),
      el("textarea", { name: "body", placeholder: "Votre commentaire ou question…", required: "required", rows: "3", maxlength: "1500" }),
      el("fieldset", { className: "status-pick" },
        el("legend", {}, "Votre avis sur cette décision (optionnel) :"),
        el("label", {}, el("input", { type: "radio", name: "status", value: "en-cours" }), " En cours"),
        el("label", {}, el("input", { type: "radio", name: "status", value: "a-discuter" }), " À discuter"),
        el("label", {}, el("input", { type: "radio", name: "status", value: "prise" }), " Prête à être prise"),
      ),
      // Honeypot
      el("input", { type: "text", name: "hp", tabindex: "-1", autocomplete: "off",
                    style: "position:absolute;left:-9999px;width:1px;height:1px" }),
      el("div", { className: "row submit-row" },
        el("button", { type: "submit", className: "btn" }, "Publier le commentaire"),
        el("span", { className: "form-status" }),
      ),
    );

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const payload = {
        decision,
        name: fd.get("name"),
        body: fd.get("body"),
        status: fd.get("status") || null,
        hp: fd.get("hp"),
      };
      const status = form.querySelector(".form-status");
      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      status.textContent = "Envoi…";
      status.style.color = "var(--c-fg-soft)";
      try {
        await postComment(payload);
        status.textContent = "✓ Merci, votre commentaire est publié.";
        status.style.color = "#3a7a4a";
        form.reset();
        if (onSuccess) onSuccess();
      } catch (err) {
        status.textContent = "Erreur : " + err.message;
        status.style.color = "#a02020";
      } finally {
        submitBtn.disabled = false;
      }
    });

    return form;
  }

  async function init(node) {
    const decision = node.dataset.comments;
    if (!decision) return;

    node.innerHTML = "";

    const tallyBox = el("div", { className: "tally-row" });
    const list = el("div", { className: "comments-list" }, el("p", { className: "comments-loading" }, "Chargement des commentaires…"));
    const formContainer = el("div", { className: "comment-form-container" });

    node.append(
      el("h4", {}, "💬 Commentaires"),
      tallyBox,
      list,
      el("h4", { className: "form-title" }, "Ajouter un commentaire"),
      formContainer
    );

    async function refresh() {
      try {
        const data = await fetchComments(decision);
        list.innerHTML = "";
        renderTally(data.tally, tallyBox);
        if (!data.comments?.length) {
          list.append(el("p", { className: "comments-empty" }, "Soyez le premier à donner votre avis 👇"));
        } else {
          for (const c of data.comments) list.append(renderComment(c));
        }
      } catch (err) {
        list.innerHTML = "";
        const errBox = el("div", { className: "comments-error" });
        errBox.innerHTML = `<strong>Le système de commentaires n'est pas encore actif.</strong><br>` +
          `<small>${escape(err.message)}</small><br><br>` +
          `Pour l'activer : créer une base Upstash Redis (gratuite, 30 s) et ajouter ` +
          `<code>UPSTASH_REDIS_REST_URL</code> et <code>UPSTASH_REDIS_REST_TOKEN</code> ` +
          `dans les variables d'environnement Vercel, puis redéployer.`;
        list.append(errBox);
      }
    }

    formContainer.append(makeForm(decision, refresh));
    refresh();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-comments]").forEach(init);
  });
})();
