/* WhatsApp / image export helper — vanilla, sans dépendance externe.
 *
 * Exposé : window.WhatsappExport.exportTextAsImage(title, lines, filename, opts?)
 *
 *   - title    : string (en-tête de l'image)
 *   - lines    : Array<string | { text, bold?, color?, indent? }>
 *                Une ligne vide ("" ou null) = espacement.
 *                Une ligne commençant par "## " est un sous-titre.
 *   - filename : string (ex: "dashboard.png")
 *   - opts     : { width=900, brand="Chan Ming POOL", subtitle="Mahajanga · Madagascar" }
 *
 * Pipeline :
 *   1. Génère un SVG structuré (XML inline) avec branding.
 *   2. Convertit le SVG en blob → URL → <img>.
 *   3. Dessine l'image sur un <canvas>, exporte canvas.toBlob() en PNG.
 *   4. Tente navigator.share({ files:[file] }) (Web Share Level 2).
 *   5. Fallback : trigger download du PNG via <a download>.
 */
(function () {
  "use strict";

  const DEFAULT_OPTS = {
    width: 900,
    brand: "Chan Ming POOL",
    subtitle: "Mahajanga · Madagascar",
    bg: "#f8f6f1",
    bgCard: "#ffffff",
    fg: "#1a1a1a",
    fgSoft: "#5a5a5a",
    accent: "#06657f",
    line: "#e5e0d6",
    pad: 36,
    titleSize: 38,
    subtitleSize: 16,
    sectionSize: 22,
    lineSize: 18,
    lineSpacing: 1.5,
  };

  // ─── 1. Échappement XML ────────────────────────────────────────────
  function xmlEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;"
    }[c]));
  }

  // Découpe un texte en plusieurs lignes pour respecter approxCharsPerLine
  function wrapText(s, maxChars) {
    if (!s) return [""];
    const words = String(s).split(/\s+/);
    const out = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > maxChars && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // ─── 2. Construction SVG ───────────────────────────────────────────
  function buildSvg(title, lines, opts) {
    const O = { ...DEFAULT_OPTS, ...(opts || {}) };
    const w = O.width;
    const charsPerLine = Math.floor((w - 2 * O.pad) / (O.lineSize * 0.55));

    // Pré-traitement des lignes (wrap, structure)
    const items = [];
    for (const raw of lines) {
      if (raw == null || raw === "") {
        items.push({ kind: "spacer" });
        continue;
      }
      const item = (typeof raw === "string") ? { text: raw } : { ...raw };
      const txt = String(item.text || "");
      // sous-titre "## ..."
      if (txt.startsWith("## ")) {
        items.push({ kind: "section", text: txt.slice(3) });
        continue;
      }
      const wrapped = wrapText(txt, charsPerLine - (item.indent ? 4 : 0));
      for (let i = 0; i < wrapped.length; i++) {
        items.push({
          kind: "text",
          text: wrapped[i],
          bold: !!item.bold,
          color: item.color || null,
          indent: !!item.indent,
          continuation: i > 0,
        });
      }
    }

    // Calcul hauteur
    const headerH = O.pad + O.titleSize + 8 + O.subtitleSize + 18;
    let bodyH = 0;
    for (const it of items) {
      if (it.kind === "spacer") bodyH += O.lineSize * 0.6;
      else if (it.kind === "section") bodyH += O.lineSize * 1.4 + O.sectionSize;
      else bodyH += O.lineSize * O.lineSpacing;
    }
    const footerH = 50;
    const totalH = Math.ceil(headerH + bodyH + footerH + O.pad);

    // SVG
    const parts = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${totalH}" viewBox="0 0 ${w} ${totalH}">`);
    parts.push(`<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${O.bg}"/>
        <stop offset="100%" stop-color="${O.bgCard}"/>
      </linearGradient>
    </defs>`);
    parts.push(`<rect width="${w}" height="${totalH}" fill="url(#bg)"/>`);

    // Bandeau accent
    parts.push(`<rect x="0" y="0" width="${w}" height="6" fill="${O.accent}"/>`);

    // Brand & subtitle
    let y = O.pad + O.titleSize;
    parts.push(`<text x="${O.pad}" y="${y}" font-family="Georgia, 'Cormorant Garamond', serif" font-size="${O.titleSize}" font-weight="500" fill="${O.fg}">${xmlEsc(O.brand)}</text>`);
    y += O.subtitleSize + 4;
    parts.push(`<text x="${O.pad}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${O.subtitleSize}" fill="${O.fgSoft}">${xmlEsc(O.subtitle)}</text>`);
    y += 8;
    parts.push(`<line x1="${O.pad}" y1="${y}" x2="${w - O.pad}" y2="${y}" stroke="${O.line}" stroke-width="1"/>`);
    y += 16;

    // Title (de l'export)
    parts.push(`<text x="${O.pad}" y="${y + O.sectionSize}" font-family="Helvetica, Arial, sans-serif" font-size="${O.sectionSize}" font-weight="600" fill="${O.accent}">${xmlEsc(title)}</text>`);
    y += O.sectionSize + 12;

    // Body
    for (const it of items) {
      if (it.kind === "spacer") {
        y += O.lineSize * 0.6;
        continue;
      }
      if (it.kind === "section") {
        y += 8;
        parts.push(`<text x="${O.pad}" y="${y + O.sectionSize - 6}" font-family="Helvetica, Arial, sans-serif" font-size="${O.sectionSize}" font-weight="600" fill="${O.fg}">${xmlEsc(it.text)}</text>`);
        // soulignement léger
        const ulY = y + O.sectionSize - 2;
        parts.push(`<line x1="${O.pad}" y1="${ulY}" x2="${O.pad + 50}" y2="${ulY}" stroke="${O.accent}" stroke-width="2"/>`);
        y += O.sectionSize + 8;
        continue;
      }
      // text line
      const x = O.pad + (it.indent ? 24 : 0);
      const fill = it.color || (it.continuation ? O.fgSoft : O.fg);
      const weight = it.bold ? "600" : "400";
      parts.push(`<text x="${x}" y="${y + O.lineSize}" font-family="Helvetica, Arial, sans-serif" font-size="${O.lineSize}" font-weight="${weight}" fill="${fill}">${xmlEsc(it.text)}</text>`);
      y += O.lineSize * O.lineSpacing;
    }

    // Footer
    const footerY = totalH - O.pad / 1.5;
    parts.push(`<line x1="${O.pad}" y1="${footerY - 18}" x2="${w - O.pad}" y2="${footerY - 18}" stroke="${O.line}" stroke-width="1"/>`);
    const stamp = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    parts.push(`<text x="${O.pad}" y="${footerY}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${O.fgSoft}">Généré le ${xmlEsc(stamp)}</text>`);
    parts.push(`<text x="${w - O.pad}" y="${footerY}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${O.fgSoft}" text-anchor="end">chanming-pool</text>`);

    parts.push(`</svg>`);
    return { svg: parts.join(""), width: w, height: totalH };
  }

  // ─── 3. SVG → Canvas → Blob PNG ────────────────────────────────────
  function svgToPngBlob({ svg, width, height }) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement("canvas");
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("canvas.toBlob a renvoyé null"));
        }, "image/png");
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error("Erreur chargement image SVG : " + (e?.message || "inconnue")));
      };
      img.src = url;
    });
  }

  // ─── 4. Web Share + fallback download ──────────────────────────────
  async function shareOrDownload(blob, filename, shareData) {
    const file = new File([blob], filename, { type: "image/png" });

    // Tente Web Share Level 2 (files)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: shareData.title,
          text: shareData.text || shareData.title,
        });
        return { shared: true };
      } catch (err) {
        // L'utilisateur a peut-être annulé : on ne déclenche PAS le fallback.
        if (err && err.name === "AbortError") return { shared: false, aborted: true };
        // Sinon on retombe sur le download.
        console.warn("Web Share a échoué, fallback download:", err);
      }
    }

    // Fallback : download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { shared: false, downloaded: true };
  }

  // ─── 5. Public API ─────────────────────────────────────────────────
  async function exportTextAsImage(title, lines, filename, opts) {
    const linesArr = Array.isArray(lines) ? lines : [String(lines || "")];
    const built = buildSvg(title || "Export", linesArr, opts);
    const blob = await svgToPngBlob(built);
    return shareOrDownload(blob, filename || "export.png", {
      title: title || "Chan Ming POOL",
      text: title || "Tableau de bord Chan Ming POOL",
    });
  }

  // Expose l'API
  window.WhatsappExport = {
    exportTextAsImage,
    // Utilitaires exposés pour tests / debug
    _buildSvg: buildSvg,
    _svgToPngBlob: svgToPngBlob,
  };
})();
