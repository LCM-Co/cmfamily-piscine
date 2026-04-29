/* Chan Ming POOL — notifications activité technique
   Sur toutes les pages, vérifie périodiquement (60 s) s'il y a de nouveaux
   messages dans /api/tech depuis la dernière visite.
   - Met à jour un badge "🔔 N" sur le lien « Technique » de la nav
   - Affiche une notification navigateur native (si l'utilisateur est abonné
     via le bouton de la page d'accueil — Notification API gérée par notify.js)
   - Le compteur de "non vus" est calculé via localStorage.lastSeenTechAt
     (mis à jour quand l'utilisateur visite la page Technique)
*/
(function () {
  const API = "/api/tech";
  const LS_LAST_SEEN = "piscine.lastSeenTechAt";
  const LS_LAST_NOTIFIED = "piscine.lastNotifiedTechMsgId";
  const POLL_MS = 60000;

  function lastSeen() {
    return localStorage.getItem(LS_LAST_SEEN) || "1970-01-01T00:00:00Z";
  }

  function setLastSeen(iso) {
    localStorage.setItem(LS_LAST_SEEN, iso);
  }

  async function fetchActivity(since) {
    try {
      const url = `${API}?resource=activity${since ? "&since=" + encodeURIComponent(since) : ""}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  function paintBadge(count) {
    const link = document.querySelector('.site-nav a[href="technique.html"]');
    if (!link) return;
    let badge = link.querySelector(".tech-nav-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "tech-nav-badge";
        link.append(badge);
      }
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.title = `${count} message${count > 1 ? "s" : ""} non vu${count > 1 ? "s" : ""} dans l'espace technique`;
    } else if (badge) {
      badge.remove();
    }
  }

  async function poll() {
    const since = lastSeen();
    const j = await fetchActivity(since);
    if (!j || !j.messages) return;

    // On ne compte pas les messages écrits par "Lennon" (l'utilisateur lui-même)
    // → on s'intéresse aux questions des autres + aux réponses de Claude
    // Pour le MVP on garde tout, le filtre côté UI peut être ajouté.
    const newMessages = j.messages || [];
    paintBadge(newMessages.length);

    // Notification système pour le tout dernier message non encore notifié
    if (newMessages.length > 0 && "Notification" in window
        && Notification.permission === "granted"
        && localStorage.getItem("piscine.notifSubscribed") === "1") {
      const latest = newMessages[0]; // ordre desc
      const lastNotifiedId = localStorage.getItem(LS_LAST_NOTIFIED);
      if (latest.id !== lastNotifiedId) {
        try {
          new Notification("Chan Ming POOL — Technique", {
            body: `${latest.author} a écrit dans « ${latest.thread_title} »\n${latest.preview.slice(0, 120)}`,
            tag: "tech-msg-" + latest.id,
            icon: "/favicon.png",
            requireInteraction: false,
          });
          localStorage.setItem(LS_LAST_NOTIFIED, latest.id);
        } catch {}
      }
    }
  }

  // Si on est sur la page Technique, mettre à jour lastSeen au chargement et au déchargement
  function isTechPage() {
    return /\/technique\.html$/.test(location.pathname);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isTechPage()) {
      // L'utilisateur regarde la page → marquer tout comme vu après 2s (le temps de visualiser)
      setTimeout(() => {
        setLastSeen(new Date().toISOString());
        paintBadge(0);
      }, 2000);
    } else {
      // Polling sur les autres pages
      poll();
      setInterval(poll, POLL_MS);
    }
  });

  // Quand la fenêtre redevient active, repoll
  window.addEventListener("focus", () => {
    if (!isTechPage()) poll();
  });
})();
