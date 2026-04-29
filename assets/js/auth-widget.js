/* Chan Ming POOL — Auth widget auto-monté
 *
 * - Injecte un bouton « 🔐 Se connecter / Mon compte » dans .site-header .container
 * - Modale magic link
 * - Au démarrage, si PIN local existe et pas de session active, prompte le PIN
 *
 * Aucun HTML existant n'est modifié : on attache via JS au DOMContentLoaded.
 *
 * Charge auth.css automatiquement.
 */

import {
  signIn, signOut, currentUser, onAuthChange,
  hasPin, setPin, removePin, tryAutoUnlock, client,
} from "./auth.js";

// ───────── Helpers DOM ─────────
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function ensureCss() {
  if (document.querySelector('link[data-cmpool-auth-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/css/auth.css";
  link.setAttribute("data-cmpool-auth-css", "1");
  document.head.appendChild(link);
}

// ───────── State ─────────
let _currentUser = null;
let _btn = null;

// ───────── Bouton header ─────────
function injectButton() {
  const target = document.querySelector(".site-header .container");
  if (!target) return null;
  if (target.querySelector("[data-cmpool-auth-btn]")) {
    return target.querySelector("[data-cmpool-auth-btn]");
  }
  const btn = el("button", {
    class: "cmpool-auth-btn",
    "data-cmpool-auth-btn": "1",
    type: "button",
    onclick: openModal,
  }, "🔐 Se connecter");
  target.appendChild(btn);
  return btn;
}

function refreshButtonLabel() {
  if (!_btn) return;
  if (_currentUser) {
    const email = _currentUser.email || "Mon compte";
    _btn.textContent = "👤 " + email;
    _btn.title = "Cliquez pour gérer votre compte";
  } else {
    _btn.textContent = "🔐 Se connecter";
    _btn.title = "Connexion par lien magique";
  }
}

// ───────── Modal ─────────
function openModal() {
  closeModal();
  const overlay = el("div", { class: "cmpool-auth-overlay", "data-cmpool-auth-modal": "1" });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  const card = el("div", { class: "cmpool-auth-card" });
  card.appendChild(el("button", {
    class: "cmpool-auth-close", type: "button", "aria-label": "Fermer", onclick: closeModal,
  }, "×"));

  if (_currentUser) {
    card.appendChild(el("h2", {}, "Mon compte"));
    card.appendChild(el("p", { class: "cmpool-auth-meta" }, _currentUser.email || ""));

    // Section PIN
    const pinSection = el("div", { class: "cmpool-auth-section" });
    pinSection.appendChild(el("h3", {}, "PIN local"));
    hasPin().then((has) => {
      if (has) {
        pinSection.appendChild(el("p", {}, "Un PIN est enregistré sur cet appareil pour reconnecter rapidement sans email."));
        pinSection.appendChild(el("button", {
          class: "cmpool-auth-btn-secondary", type: "button",
          onclick: async () => {
            await removePin();
            alert("PIN supprimé.");
            closeModal(); openModal();
          },
        }, "Supprimer le PIN"));
      } else {
        pinSection.appendChild(el("p", {}, "Définir un PIN pour reconnecter rapidement sur cet appareil :"));
        const inp = el("input", { type: "password", placeholder: "Min. 4 caractères", class: "cmpool-auth-input", inputmode: "numeric" });
        const btn = el("button", {
          class: "cmpool-auth-btn-primary", type: "button",
          onclick: async () => {
            try {
              await setPin(inp.value);
              alert("PIN enregistré.");
              closeModal(); openModal();
            } catch (e) { alert(e.message || String(e)); }
          },
        }, "Enregistrer le PIN");
        pinSection.appendChild(inp);
        pinSection.appendChild(btn);
      }
    });
    card.appendChild(pinSection);

    // Déconnexion
    card.appendChild(el("button", {
      class: "cmpool-auth-btn-danger", type: "button",
      onclick: async () => {
        try { await signOut(); closeModal(); } catch (e) { alert(e.message); }
      },
    }, "Se déconnecter"));
  } else {
    card.appendChild(el("h2", {}, "Connexion"));
    card.appendChild(el("p", {}, "Saisissez votre email — vous recevrez un lien magique pour vous connecter."));

    const form = el("form", { class: "cmpool-auth-form" });
    const email = el("input", {
      type: "email", required: "true", placeholder: "vous@exemple.com",
      class: "cmpool-auth-input", autocomplete: "email",
    });
    const submit = el("button", {
      class: "cmpool-auth-btn-primary", type: "submit",
    }, "Recevoir le lien");
    const status = el("div", { class: "cmpool-auth-status" });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      status.textContent = "Envoi en cours…";
      try {
        await signIn(email.value);
        status.textContent = "Lien envoyé ! Vérifiez votre boîte mail.";
        status.className = "cmpool-auth-status ok";
      } catch (err) {
        status.textContent = "Erreur : " + (err.message || String(err));
        status.className = "cmpool-auth-status err";
      } finally {
        submit.disabled = false;
      }
    });
    form.appendChild(email);
    form.appendChild(submit);
    card.appendChild(form);
    card.appendChild(status);

    // Si PIN existe, proposer raccourci
    hasPin().then((has) => {
      if (!has) return;
      const pinBox = el("div", { class: "cmpool-auth-section" });
      pinBox.appendChild(el("h3", {}, "Reconnexion par PIN"));
      const pinInp = el("input", { type: "password", placeholder: "PIN local", class: "cmpool-auth-input", inputmode: "numeric" });
      const pinBtn = el("button", {
        class: "cmpool-auth-btn-secondary", type: "button",
        onclick: async () => {
          try {
            const sb = client();
            const { data, error } = await sb.auth.refreshSession();
            if (data?.session) { closeModal(); return; }
            const out = await tryAutoUnlock(async () => pinInp.value);
            if (out && !out.error) closeModal();
            else alert(out?.error || "Échec de la reconnexion.");
          } catch (e) { alert(e.message || String(e)); }
        },
      }, "Déverrouiller");
      pinBox.appendChild(pinInp);
      pinBox.appendChild(pinBtn);
      card.appendChild(pinBox);
    });
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.classList.add("cmpool-auth-open");
}

function closeModal() {
  const m = document.querySelector('[data-cmpool-auth-modal]');
  if (m) m.remove();
  document.body.classList.remove("cmpool-auth-open");
}

// ───────── Bootstrap ─────────
async function init() {
  ensureCss();
  _btn = injectButton();
  if (!_btn) return; // pas de header sur cette page

  // Restore session if PIN exists and no current session
  try {
    if (await hasPin()) {
      const u = await currentUser();
      if (!u) {
        // prompt PIN une seule fois
        const pin = window.prompt("PIN local (laisser vide pour ignorer) :", "");
        if (pin) {
          try { await tryAutoUnlock(async () => pin); } catch (e) { /* ignore */ }
        }
      }
    }
  } catch (e) { /* swallow */ }

  // Initial state
  try { _currentUser = await currentUser(); } catch (e) { _currentUser = null; }
  refreshButtonLabel();

  // Listen to auth changes
  onAuthChange((event, session) => {
    _currentUser = session?.user || null;
    refreshButtonLabel();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
