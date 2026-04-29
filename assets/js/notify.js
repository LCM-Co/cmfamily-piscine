/* Piscine Lennon — système de notifications navigateur natif
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
      new Notification("Piscine Lennon", {
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
      new Notification("Piscine Lennon", {
        body: "C'est parti — vous recevrez les nouvelles décisions ici.",
        icon: "/favicon.png"
      });
    }
  }

  function checkForNewDecision() {
    const current = metaValue();
    if (!current) return;
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (current === lastSeen) return;
    if (isSubscribed() && lastSeen) {
      new Notification("Piscine Lennon — Nouvelle décision", {
        body: metaTitle(),
        icon: "/favicon.png",
        tag: "piscine-decision",
        requireInteraction: false
      });
    }
    localStorage.setItem(STORAGE_KEY, current);
  }

  function toggleComments(e) {
    e.preventDefault();
    const panel = document.querySelector(e.target.dataset.target);
    if (panel) panel.classList.toggle("open");
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-subscribe-btn]").forEach(b => {
      b.addEventListener("click", subscribe);
    });
    document.querySelectorAll("[data-toggle-comments]").forEach(b => {
      b.addEventListener("click", toggleComments);
    });
    updateButtons();
    checkForNewDecision();
  });
})();
