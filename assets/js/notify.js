/* Chan Ming POOL — système de notifications navigateur natif
   Détecte une nouvelle décision via la balise <meta name="last-decision-id">
   et affiche une notification système si l'utilisateur a accordé la permission.
*/
(function() {
  const META_KEY = "last-decision-id";
  const STORAGE_KEY = "piscine.lastSeenDecisionId";
  const SUBSCRIBED_KEY = "piscine.notifSubscribed";

  function metaValue() {
    const m = document.querySelector(`meta[name="${META_KEY}"]`);
    return m ? m.content.trim() : null;
  }

  function metaTitle() {
    const m = document.querySelector(`meta[name="last-decision-title"]`);
    return m ? m.content.trim() : "Nouvelle décision en cours";
  }

  function isSubscribed() {
    return localStorage.getItem(SUBSCRIBED_KEY) === "1"
      && "Notification" in window
      && Notification.permission === "granted";
  }

  function setSubscribed(v) {
    localStorage.setItem(SUBSCRIBED_KEY, v ? "1" : "0");
    updateButtons();
  }

  function updateButtons() {
    const subscribed = isSubscribed();
    document.querySelectorAll("[data-subscribe-btn]").forEach(b => {
      if (subscribed) {
        b.textContent = "✓ Abonné aux alertes";
        b.classList.add("subscribed");
        b.disabled = true;
      } else {
        b.textContent = "🔔 S'abonner aux alertes";
        b.classList.remove("subscribed");
        b.disabled = false;
      }
    });
  }

  async function subscribe() {
    if (!("Notification" in window)) {
      alert("Votre navigateur ne supporte pas les notifications.");
      return;
    }
    if (Notification.permission === "granted") {
      setSubscribed(true);
      new Notification("Chan Ming POOL", {
        body: "Vous êtes inscrit aux alertes du projet.",
        icon: "/favicon.png"
      });
      return;
    }
    if (Notification.permission === "denied") {
      alert("Les notifications sont bloquées dans les paramètres du navigateur.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      setSubscribed(true);
      new Notification("Chan Ming POOL", {
        body: "C'est parti — vous recevrez les nouvelles décisions ici.",
        icon: "/favicon.png"
      });
    }
  }

  function checkForNewDecision() {
    const current = metaValue();
    if (!current) return;
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (current === lastSeen) {
      // Décision déjà vue : atténuer le bandeau accueil
      document.querySelectorAll(".notif-banner").forEach(b => {
        b.style.opacity = "0.55";
        b.dataset.alreadySeen = "1";
      });
      return;
    }
    if (isSubscribed() && lastSeen) {
      new Notification("Chan Ming POOL — Nouvelle décision", {
        body: metaTitle(),
        icon: "/favicon.png",
        tag: "piscine-decision",
        requireInteraction: false
      });
    }
    localStorage.setItem(STORAGE_KEY, current);
  }

  function setPanelOpen(panel, open) {
    if (!panel) return;
    panel.classList.toggle("open", open);
    const target = "#" + panel.id;
    document.querySelectorAll(`[data-toggle-comments][data-target="${target}"]`).forEach(btn => {
      const label = btn.dataset.openLabel || "💬 Donner mon avis";
      const closeLabel = btn.dataset.closeLabel || "🙈 Masquer le fil";
      btn.textContent = open ? closeLabel : label;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function toggleComments(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const panel = document.querySelector(btn.dataset.target);
    if (!panel) return;
    setPanelOpen(panel, !panel.classList.contains("open"));
  }

  function openPanelFromHash() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    // Cas 1 : hash = #comments-XX → ouvrir directement le panneau
    let panel = document.querySelector(hash + ".comments-panel, " + hash + " .comments-panel");
    if (!panel) {
      const target = document.querySelector(hash);
      if (target) {
        if (target.classList.contains("comments-panel")) {
          panel = target;
        } else {
          panel = target.querySelector(".comments-panel");
        }
      }
    }
    if (panel) {
      setPanelOpen(panel, true);
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handleAnchorClick(e) {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href === "#") return;
    const target = document.querySelector(href);
    if (!target) return;
    // Si l'ancre cible un panneau ou contient un panneau de commentaires, l'ouvrir
    let panel = null;
    if (target.classList.contains("comments-panel")) panel = target;
    else panel = target.querySelector(".comments-panel");
    if (panel) {
      setPanelOpen(panel, true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-subscribe-btn]").forEach(b => {
      b.addEventListener("click", subscribe);
    });
    document.querySelectorAll("[data-toggle-comments]").forEach(b => {
      b.addEventListener("click", toggleComments);
      // Initialise le label depuis data-open-label si présent
      if (b.dataset.openLabel && !b.classList.contains("comments-toggle--initialized")) {
        b.textContent = b.dataset.openLabel;
        b.classList.add("comments-toggle--initialized");
      }
    });
    document.addEventListener("click", handleAnchorClick);
    window.addEventListener("hashchange", openPanelFromHash);
    updateButtons();
    checkForNewDecision();
    openPanelFromHash();
  });
})();
