/* Espace technique — frontend (threads, messages, études)
   Branché sur /api/tech.
*/
(function () {
  const API = "/api/tech";
  const LS_AUTHOR = "piscine.techAuthor";

  const DOMAIN_LABEL = {
    structure: "🏗 Structure",
    hydraulique: "💧 Hydraulique",
    electricite: "⚡ Électricité",
    traitement_eau: "🧪 Traitement eau",
    etancheite: "🛡 Étanchéité",
    tests_qualite: "✅ Tests qualité",
    general: "💭 Général",
  };

  const STATUS_LABEL = {
    draft: "Brouillon",
    review: "En revue",
    validated: "Validée",
    obsolete: "Obsolète",
    open: "Ouverte",
    closed: "Fermée",
    blocked: "Bloquée",
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

  // Mini rendu Markdown (limité, suffisant pour l'usage interne)
  function mdToHtml(md) {
    let s = escape(md || "");
    // code blocks ```...```
    s = s.replace(/```([^`]+)```/g, (_, c) => `<pre>${c.trim()}</pre>`);
    // inline code
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // headers ### / ##
    s = s.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    s = s.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    // unordered lists
    s = s.replace(/(^|\n)((?:- .+\n?)+)/g, (_, p, list) => {
      const items = list.trim().split(/\n/).map(line => `<li>${line.replace(/^- /, "")}</li>`).join("");
      return `${p}<ul>${items}</ul>`;
    });
    // tables (simple)
    s = s.replace(/((?:\|[^\n]+\|\n?)+)/g, block => {
      const rows = block.trim().split(/\n/).filter(r => r.trim().startsWith("|"));
      if (rows.length < 2) return block;
      const head = rows[0].split("|").slice(1, -1).map(c => `<th>${c.trim()}</th>`).join("");
      const body = rows.slice(rows[1].includes("---") ? 2 : 1)
        .map(r => "<tr>" + r.split("|").slice(1, -1).map(c => `<td>${c.trim()}</td>`).join("") + "</tr>").join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    });
    // line breaks (paragraphs)
    s = s.split(/\n{2,}/).map(p => p.trim() ? (p.startsWith("<") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`) : "").join("");
    return s;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
    discussions: document.getElementById("panel-discussions"),
    studies: document.getElementById("panel-studies"),
  };
  for (const t of tabs) {
    t.addEventListener("click", () => {
      const target = t.dataset.tab;
      tabs.forEach(x => {
        x.classList.toggle("active", x.dataset.tab === target);
        x.setAttribute("aria-selected", x.dataset.tab === target ? "true" : "false");
      });
      Object.entries(panels).forEach(([k, p]) => p.hidden = k !== target);
      if (target === "studies" && !studiesLoaded) loadStudies();
    });
  }

  // ─── Threads ──────────────────────────────────────────────────────
  let allThreads = [];
  let threadFilter = "all";

  function renderThreads() {
    const wrap = document.getElementById("threads-list");
    wrap.innerHTML = "";
    const filtered = threadFilter === "all" ? allThreads : allThreads.filter(t => t.domain === threadFilter);
    if (!filtered.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune discussion. Crée la première via « ➕ Nouvelle discussion »."));
      return;
    }
    for (const t of filtered) {
      const card = el("div", {
        className: "thread-card" + (t.is_public ? " public-thread" : " private")
                 + (t.status === "closed" ? " closed" : "")
                 + (t.pinned_message_id ? " has-pinned" : ""),
        onclick: () => openThread(t.id),
      },
        el("span", { className: "domain-tag" }, DOMAIN_LABEL[t.domain] || t.domain),
        el("span", { className: "title" }, t.title),
        t.pinned_message_id ? el("span", { className: "pin-flag", title: "Conclusion épinglée" }, "📌 Conclusion") : null,
        el("span", { className: "meta" },
          (t.message_count ? `${t.message_count} message${t.message_count > 1 ? "s" : ""} · ` : "") +
          (t.last_message_at ? "Dernier : " + fmtDate(t.last_message_at) : "Jamais ouvert")
        ),
        el("span", { className: "privacy" }, t.is_public ? "👁 Public" : "🔒 Privé"),
      );
      wrap.append(card);
    }
    document.getElementById("discussions-count").textContent = String(allThreads.length);
  }

  async function loadThreads() {
    try {
      const j = await api("?resource=threads");
      allThreads = j.threads || [];
      renderThreads();
    } catch (e) {
      document.getElementById("threads-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }

  document.querySelectorAll("[data-filter]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach(x => x.classList.toggle("active", x === b));
      threadFilter = b.dataset.filter;
      renderThreads();
    });
  });

  // ─── Thread detail (modal) ────────────────────────────────────────
  async function openThread(id) {
    try {
      const j = await api("?resource=thread&id=" + encodeURIComponent(id));
      showThreadModal(j.thread, j.messages, j.pinned);
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  }

  function showThreadModal(thread, messages, pinned) {
    const overlay = el("div", { className: "thread-detail", onclick: e => { if (e.target === overlay) close(); } });
    const pinnedWrap = el("div", { className: "pinned-block" });
    const messagesWrap = el("div", { className: "messages-stream" });
    let _thread = thread;

    async function togglePin(messageId) {
      const isUnpin = _thread.pinned_message_id === messageId;
      try {
        const author = localStorage.getItem(LS_AUTHOR) || "Lennon";
        const j = await api("?resource=pin", { method: "POST",
          body: { thread_id: _thread.id, message_id: isUnpin ? null : messageId, author } });
        _thread = j.thread;
        const newPinned = _thread.pinned_message_id
          ? messages.find(m => m.id === _thread.pinned_message_id) || null
          : null;
        renderPinned(newPinned);
        renderMessages(messages);
      } catch (err) {
        alert("Erreur : " + err.message);
      }
    }

    function renderPinned(pinnedMsg) {
      pinnedWrap.innerHTML = "";
      if (!pinnedMsg) return;
      const inner = el("div", { className: "pinned-block-inner collapsed" });
      const toggleBtn = el("button", {
        className: "btn-pinned-toggle",
        title: "Déplier / replier la conclusion",
        onclick: () => {
          inner.classList.toggle("collapsed");
          toggleBtn.textContent = inner.classList.contains("collapsed") ? "Voir le détail ▾" : "Replier ▴";
        }
      }, "Voir le détail ▾");

      inner.append(
        el("div", { className: "pinned-head" },
          el("span", { className: "pinned-icon" }, "📌"),
          el("strong", {}, "Conclusion qui fait foi"),
          el("span", { className: "pinned-meta" },
            "par " + (pinnedMsg.author || "?") + " · " + fmtDate(pinnedMsg.created_at)),
          toggleBtn,
          el("button", { className: "btn-unpin",
            title: "Désépingler", onclick: () => togglePin(pinnedMsg.id) }, "✕"),
        ),
        el("div", { className: "pinned-body", html: mdToHtml(pinnedMsg.body_md) })
      );
      pinnedWrap.append(inner);
    }

    function renderMessages(msgs) {
      messagesWrap.innerHTML = "";
      if (!msgs.length) {
        messagesWrap.append(el("p", { className: "empty-state" }, "Aucun message — sois le premier à écrire."));
        return;
      }
      for (const m of msgs) {
        const fromLennon = (m.author || "").toLowerCase().includes("lennon");
        const isPinned = _thread.pinned_message_id === m.id;
        const card = el("div", {
          className: "message-card " + (fromLennon ? "from-lennon" : "from-claude") + (isPinned ? " is-pinned" : "")
        },
          el("div", { className: "head" },
            el("strong", {}, m.author),
            el("span", {}, fmtDate(m.created_at)),
            el("button", {
              className: "btn-pin" + (isPinned ? " active" : ""),
              title: isPinned ? "Désépingler ce message" : "Épingler ce message comme conclusion du thread",
              onclick: e => { e.stopPropagation(); togglePin(m.id); }
            }, isPinned ? "📌 Épinglé" : "📌")
          ),
          el("div", { className: "body", html: mdToHtml(m.body_md) })
        );
        messagesWrap.append(card);
      }
      messagesWrap.scrollTop = messagesWrap.scrollHeight;
    }
    renderPinned(pinned);
    renderMessages(messages);

    const nameInput = el("input", {
      type: "text", placeholder: "Ton nom", maxlength: "60",
      value: localStorage.getItem(LS_AUTHOR) || "",
    });
    const bodyInput = el("textarea", { placeholder: "Écris ton message (Markdown supporté)…", rows: 3 });
    const sendBtn = el("button", { type: "submit" }, "Envoyer");

    const form = el("form", { className: "message-form",
      onsubmit: async e => {
        e.preventDefault();
        const author = nameInput.value.trim();
        const body = bodyInput.value.trim();
        if (!author || body.length < 1) return;
        sendBtn.disabled = true;
        try {
          const j = await api("?resource=message", { method: "POST",
            body: { thread_id: thread.id, author, body_md: body } });
          messages.push(j.message);
          renderMessages(messages);
          bodyInput.value = "";
          localStorage.setItem(LS_AUTHOR, author);
          loadThreads();
        } catch (err) {
          alert("Erreur : " + err.message);
        } finally {
          sendBtn.disabled = false;
        }
      },
    },
      el("div", { className: "message-form-row" }, nameInput, bodyInput, sendBtn)
    );

    const inner = el("div", { className: "thread-detail-inner" },
      el("div", { className: "thread-detail-head" },
        el("h3", {}, thread.title),
        el("span", { className: "domain-tag" }, DOMAIN_LABEL[thread.domain] || thread.domain),
        el("span", { className: "privacy" }, thread.is_public ? "👁 Public" : "🔒 Privé"),
        el("button", { className: "thread-detail-close", onclick: close, "aria-label": "Fermer" }, "×"),
      ),
      pinnedWrap, messagesWrap, form,
    );
    overlay.append(inner);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    bodyInput.focus();
    function close() { overlay.remove(); document.body.style.overflow = ""; }
  }

  // ─── Création thread ──────────────────────────────────────────────
  document.getElementById("btn-new-thread").addEventListener("click", () => {
    const overlay = el("div", { className: "dec-modal-overlay", onclick: e => { if (e.target === overlay) close(); } });
    const titleInput = el("input", { type: "text", required: "true", placeholder: "Ex : Vérification ferraillage radier" });
    const domainSelect = el("select", { required: "true" });
    for (const [k, v] of Object.entries(DOMAIN_LABEL)) {
      domainSelect.append(el("option", { value: k }, v));
    }
    const isPublicInput = el("input", { type: "checkbox" });
    const submitBtn = el("button", { type: "submit", className: "btn dec-submit" }, "Créer");
    const cancelBtn = el("button", { type: "button", className: "btn btn-secondary" }, "Annuler");
    const error = el("div", { className: "dec-form-error" });

    const form = el("form", { className: "dec-form",
      onsubmit: async e => {
        e.preventDefault();
        submitBtn.disabled = true;
        error.textContent = "";
        try {
          const j = await api("?resource=thread", { method: "POST",
            body: { title: titleInput.value.trim(), domain: domainSelect.value, is_public: isPublicInput.checked } });
          close();
          await loadThreads();
          openThread(j.thread.id);
        } catch (err) {
          error.textContent = err.message;
        } finally {
          submitBtn.disabled = false;
        }
      }
    },
      el("label", { className: "dec-field" }, "Titre", titleInput),
      el("label", { className: "dec-field" }, "Domaine", domainSelect),
      el("label", { className: "dec-checkbox" }, isPublicInput, " Visible par la famille (sinon privé toi+Claude)"),
      error,
      el("div", { className: "dec-form-actions" }, submitBtn, cancelBtn),
    );
    cancelBtn.addEventListener("click", close);

    const modal = el("div", { className: "dec-modal" },
      el("div", { className: "dec-modal-head" },
        el("h3", {}, "➕ Nouvelle discussion"),
        el("button", { className: "dec-modal-close", onclick: close }, "×")
      ),
      form,
    );
    overlay.append(modal);
    document.body.append(overlay);
    document.body.classList.add("dec-modal-open");
    titleInput.focus();
    function close() { overlay.remove(); document.body.classList.remove("dec-modal-open"); }
  });

  // ─── Studies ──────────────────────────────────────────────────────
  let allStudies = [];
  let studiesLoaded = false;
  let studyFilter = "all";

  function renderStudies() {
    const wrap = document.getElementById("studies-list");
    wrap.innerHTML = "";
    const filtered = studyFilter === "all" ? allStudies : allStudies.filter(s => s.domain === studyFilter);
    if (!filtered.length) {
      wrap.append(el("p", { className: "empty-state" }, "Aucune fiche dans ce domaine."));
      return;
    }
    for (const s of filtered) {
      const card = el("div", {
        className: "study-card " + (s.status || "draft"),
        onclick: () => openStudy(s.id),
      },
        el("div", { className: "domain-tag" }, DOMAIN_LABEL[s.domain] || s.domain),
        el("h3", { className: "title" }, s.title),
        el("span", { className: "status-badge " + (s.status || "draft") }, STATUS_LABEL[s.status] || s.status),
      );
      wrap.append(card);
    }
    document.getElementById("studies-count").textContent = String(allStudies.length);
  }

  async function loadStudies() {
    try {
      const j = await api("?resource=studies");
      allStudies = j.studies || [];
      studiesLoaded = true;
      renderStudies();
    } catch (e) {
      document.getElementById("studies-list").innerHTML = `<p class="empty-state">Erreur : ${escape(e.message)}</p>`;
    }
  }

  async function openStudy(id) {
    try {
      const j = await api("?resource=study&id=" + encodeURIComponent(id));
      showStudyModal(j.study);
    } catch (e) { alert("Erreur : " + e.message); }
  }

  function showStudyModal(study) {
    const overlay = el("div", { className: "thread-detail", onclick: e => { if (e.target === overlay) close(); } });

    const inner = el("div", { className: "thread-detail-inner" });
    const head = el("div", { className: "thread-detail-head" },
      el("h3", {}, study.title),
      el("span", { className: "domain-tag" }, DOMAIN_LABEL[study.domain] || study.domain),
      el("span", { className: "status-badge " + (study.status || "draft") }, STATUS_LABEL[study.status] || study.status),
      el("button", { className: "thread-detail-close", onclick: close }, "×"),
    );
    const body = el("div", { className: "messages-stream" },
      el("div", { className: "message-card", style: "max-width:100%" },
        el("div", { className: "body", html: mdToHtml(study.body_md || "_Aucune description._") })
      ),
      study.conclusions_md ? el("div", { className: "message-card from-lennon", style: "max-width:100%" },
        el("h4", { style: "margin:0 0 8px;" }, "Conclusions"),
        el("div", { className: "body", html: mdToHtml(study.conclusions_md) })
      ) : null,
    );
    inner.append(head, body);
    overlay.append(inner);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    function close() { overlay.remove(); document.body.style.overflow = ""; }
  }

  document.querySelectorAll("[data-study-filter]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-study-filter]").forEach(x => x.classList.toggle("active", x === b));
      studyFilter = b.dataset.studyFilter;
      renderStudies();
    });
  });

  // ─── Bootstrap ────────────────────────────────────────────────────
  loadThreads();
})();
