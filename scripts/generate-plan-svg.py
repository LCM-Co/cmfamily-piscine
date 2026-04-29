#!/usr/bin/env python3
"""
Génère un plan 2D vectoriel (SVG) à partir des coordonnées exactes du
modèle 3D Three.js (viewer/index.html). Le plan est ainsi par construction
cohérent avec la 3D, et peut être régénéré après chaque modification
du modèle.

Usage :
    python3 scripts/generate-plan-svg.py

Sortie : assets/plan-3d.svg
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWER = ROOT / "viewer" / "index.html"
OUT = ROOT / "assets" / "plan-3d.svg"

# ============================================================
# Extraction des coordonnées depuis le code Three.js
# ============================================================

def parse_zone(src, name):
    """Extrait { x0, y0, x1, y1 } pour une zone simple."""
    pat = rf"{name}:\s*\{{\s*x0:\s*([-\d.]+),\s*y0:\s*([-\d.]+),\s*x1:\s*([-\d.]+),\s*y1:\s*([-\d.]+)"
    m = re.search(pat, src)
    if not m:
        return None
    return tuple(map(float, m.groups()))


def extract_all():
    src = VIEWER.read_text()
    z = {
        "GB":      parse_zone(src, "GB"),
        "PLAGE":   parse_zone(src, "PLAGE"),
        "MB":      parse_zone(src, "MB"),
        "COULOIR": parse_zone(src, "COULOIR"),
        "TERRASSE": parse_zone(src, "TERRASSE"),
        "CHEMIN":   parse_zone(src, "CHEMIN"),
        "ZEN":      parse_zone(src, "ZEN"),
        "JARDIN":   parse_zone(src, "JARDIN"),
    }
    # Lounge enveloppe
    m = re.search(r"LOUNGE:\s*\{\s*enveloppe:\s*\{\s*x0:\s*([-\d.]+),\s*y0:\s*([-\d.]+),\s*x1:\s*([-\d.]+),\s*y1:\s*([-\d.]+)", src)
    z["LOUNGE"] = tuple(map(float, m.groups())) if m else None
    # Îlot D enveloppe + jardinière
    m = re.search(r"ILOT_D:\s*\{\s*enveloppe:\s*\{\s*x0:\s*([-\d.]+),\s*y0:\s*([-\d.]+),\s*x1:\s*([-\d.]+),\s*y1:\s*([-\d.]+)", src)
    z["ILOT_D"] = tuple(map(float, m.groups())) if m else None
    m = re.search(r"jardiniere:\s*\{\s*x0:\s*([-\d.]+),\s*y0:\s*([-\d.]+),\s*x1:\s*([-\d.]+),\s*y1:\s*([-\d.]+)", src)
    z["JARDINIERE"] = tuple(map(float, m.groups())) if m else None
    # Bar tablette
    m = re.search(r"tablette:\s*\{\s*x0:\s*([-\d.]+),\s*y0:\s*([-\d.]+),\s*x1:\s*([-\d.]+),\s*y1:\s*([-\d.]+)", src)
    z["BAR"] = tuple(map(float, m.groups())) if m else None
    # Lame d'eau
    m = re.search(r"mur_ouest:\s*\{\s*x0:\s*([-\d.]+),\s*y0:\s*([-\d.]+),\s*x1:\s*([-\d.]+),\s*y1:\s*([-\d.]+)", src)
    z["LAME_EAU"] = tuple(map(float, m.groups())) if m else None

    # Locaux : déduits de la doc (vestiaire 2,0×3,8 + stockage 2,0×3,9, à x=0..2, y=17.22..24.87)
    z["VESTIAIRE"] = (0.0, 17.22, 2.0, 21.02)
    z["STOCKAGE"] = (0.0, 21.07, 2.0, 24.87)
    # Karesansui : entre couloir et locaux, x=2..3.2, y=11.87..16.87
    z["KARESANSUI"] = (2.0, 11.87, 3.2, 16.87)

    return z


# ============================================================
# Génération SVG
# ============================================================

# Cadre visible : laisse tomber le jardin lointain et le terrain est
X_MIN, X_MAX = -1.5, 13.0   # 14.5 m de large
Y_MIN, Y_MAX = -3.5, 25.5   # 29.0 m de haut
SCALE = 28                   # px par mètre
MARGIN = 60                  # marge cadre + cotation
WIDTH = (X_MAX - X_MIN) * SCALE + 2 * MARGIN
HEIGHT = (Y_MAX - Y_MIN) * SCALE + 2 * MARGIN


def x(xm):
    return MARGIN + (xm - X_MIN) * SCALE


def y(ym):
    """Y en SVG est inversé (positif = bas), notre Y modèle est positif = nord."""
    return MARGIN + (Y_MAX - ym) * SCALE


def rect(zone, fill, stroke="#2a2a2c", sw=1.2, opacity=1.0, label=None, label_color="#1a1a1c"):
    if zone is None:
        return ""
    x0, y0, x1, y1 = zone
    px = x(x0)
    py = y(y1)  # haut de rect en SVG = max Y du modèle
    w = (x1 - x0) * SCALE
    h = (y1 - y0) * SCALE
    out = (
        f'<rect x="{px:.1f}" y="{py:.1f}" width="{w:.1f}" height="{h:.1f}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"/>'
    )
    if label:
        cx = px + w / 2
        cy = py + h / 2
        out += (
            f'<text x="{cx:.1f}" y="{cy:.1f}" fill="{label_color}" '
            f'font-size="11" font-weight="600" text-anchor="middle" dominant-baseline="middle">'
            f'{label}</text>'
        )
    return out


def cote(x0_m, y0_m, x1_m, y1_m, text, color="#1a1a1c"):
    """Affiche une cote (ligne entre deux points avec étiquette au milieu)."""
    px0, py0 = x(x0_m), y(y0_m)
    px1, py1 = x(x1_m), y(y1_m)
    cx = (px0 + px1) / 2
    cy = (py0 + py1) / 2
    line = (
        f'<line x1="{px0:.1f}" y1="{py0:.1f}" x2="{px1:.1f}" y2="{py1:.1f}" '
        f'stroke="{color}" stroke-width="0.8" stroke-dasharray="3,2"/>'
    )
    label = (
        f'<text x="{cx:.1f}" y="{cy - 4:.1f}" fill="{color}" font-size="9" '
        f'text-anchor="middle">{text}</text>'
    )
    return line + label


def main():
    if not VIEWER.exists():
        print(f"ERREUR : {VIEWER} introuvable", file=sys.stderr)
        return 2

    z = extract_all()

    # Calcul surfaces et volumes (pour le bandeau)
    def area(zone):
        x0, y0, x1, y1 = zone
        return (x1 - x0) * (y1 - y0)

    surf_eau = area(z["GB"]) + area(z["PLAGE"]) + area(z["MB"]) + area(z["COULOIR"])

    parts = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH:.0f} {HEIGHT:.0f}" '
        f'width="{WIDTH:.0f}" height="{HEIGHT:.0f}" '
        'preserveAspectRatio="xMidYMid meet" '
        'style="max-width:100%;height:auto;background:#f7f4ee;font-family:-apple-system,sans-serif;">'
    )

    # Cadre + grille 1 m discrète
    parts.append('<g stroke="#e3ddd1" stroke-width="0.5">')
    for ix in range(int(X_MIN), int(X_MAX) + 1):
        parts.append(f'<line x1="{x(ix):.1f}" y1="{y(Y_MAX):.1f}" x2="{x(ix):.1f}" y2="{y(Y_MIN):.1f}"/>')
    for iy in range(int(Y_MIN), int(Y_MAX) + 1):
        parts.append(f'<line x1="{x(X_MIN):.1f}" y1="{y(iy):.1f}" x2="{x(X_MAX):.1f}" y2="{y(iy):.1f}"/>')
    parts.append('</g>')

    # Zones paysagères (fond)
    parts.append(rect(z["JARDIN"],   "#cfdcc0", opacity=0.55))
    parts.append(rect(z["ZEN"],      "#b8c9a5", opacity=0.7, label="Espace zen 9,28×13,00", label_color="#3a4a30"))
    parts.append(rect(z["TERRASSE"], "#caa279", opacity=0.85, label="Terrasse Hintsy 11,28×2,52", label_color="#3a2a18"))
    parts.append(rect(z["CHEMIN"],   "#caa279", opacity=0.85))

    # Karesansui
    parts.append(rect(z["KARESANSUI"], "#e8e0c8", stroke="#8a7d5a", sw=0.8, opacity=0.95, label="Karesansui", label_color="#5a4d2a"))

    # Locaux
    parts.append(rect(z["VESTIAIRE"], "#f0eee8", stroke="#5a5a5a", label="Vestiaire 2,0×3,8", label_color="#1a1a1c"))
    parts.append(rect(z["STOCKAGE"],  "#f0eee8", stroke="#5a5a5a", label="Stockage 2,0×3,9", label_color="#1a1a1c"))

    # Bassins (eau) — bleu profond pour GB, dégradé selon profondeur
    parts.append(rect(z["GB"],      "#4a6478", stroke="#2a3a48", sw=1.5, label="Grand Bassin\\n7,04×7,87 / −1,80", label_color="#f0f4f8"))
    parts.append(rect(z["MB"],      "#5e7a90", stroke="#2a3a48", sw=1.5, label="Moyen Bassin 7,28×4 / −1,40", label_color="#f0f4f8"))
    parts.append(rect(z["COULOIR"], "#5e7a90", stroke="#2a3a48", sw=1.5, label="Couloir\\n2×5\\n−1,40", label_color="#f0f4f8"))
    parts.append(rect(z["PLAGE"],   "#9bbcd0", stroke="#2a3a48", sw=1.5, label="Plage 3,24×7,87 / −0,60", label_color="#1a3040"))

    # Lounge sec
    parts.append(rect(z["LOUNGE"], "#3a3d40", stroke="#1a1a1c", sw=1.5, label="Sunken Lounge B (sec)\\n4,35×4,00 / −1,05", label_color="#e8e8e8"))

    # Lame d'eau (mur ouest) — trait épais granit noir
    if z["LAME_EAU"]:
        x0, y0, x1, y1 = z["LAME_EAU"]
        parts.append(
            f'<rect x="{x(x0):.1f}" y="{y(y1):.1f}" width="{(x1-x0)*SCALE:.1f}" '
            f'height="{(y1-y0)*SCALE:.1f}" fill="#1a1a1c"/>'
        )
        # Étiquette
        parts.append(
            f'<text x="{x(-0.2):.1f}" y="{y(8):.1f}" fill="#1a1a1c" font-size="10" '
            f'font-weight="600" text-anchor="end" transform="rotate(-90 {x(-0.2):.1f},{y(8):.1f})">'
            f'Lame d\'eau granit · 17 m (12 m débordement)</text>'
        )

    # Bar
    parts.append(rect(z["BAR"], "#1a1a1c", stroke="#000"))
    if z["BAR"]:
        bx0, by0, bx1, by1 = z["BAR"]
        parts.append(
            f'<text x="{x((bx0+bx1)/2):.1f}" y="{y((by0+by1)/2):.1f}" fill="#f0c060" '
            f'font-size="8" text-anchor="middle" dominant-baseline="middle">Bar</text>'
        )
        # 3 tabourets
        for ty in (9.17, 9.87, 10.57):
            parts.append(
                f'<circle cx="{x(6.5):.1f}" cy="{y(ty):.1f}" r="{0.19*SCALE:.1f}" '
                f'fill="#caa279" stroke="#5a4220" stroke-width="0.8"/>'
            )

    # Îlot D + Satrana
    parts.append(rect(z["ILOT_D"],     "#c8c4be", stroke="#7a7770", sw=1.2))
    parts.append(rect(z["JARDINIERE"], "#e8d099", stroke="#a08850"))
    if z["ILOT_D"]:
        ix0, iy0, ix1, iy1 = z["ILOT_D"]
        cx, cy = (ix0+ix1)/2, (iy0+iy1)/2
        # Couronne palmier (cercle vert argenté)
        parts.append(
            f'<circle cx="{x(cx):.1f}" cy="{y(cy):.1f}" r="{1.0*SCALE:.1f}" '
            f'fill="#6a8a78" opacity="0.55"/>'
        )
        parts.append(
            f'<text x="{x(cx):.1f}" y="{y(cy):.1f}" fill="#1a3024" font-size="9" '
            f'font-weight="600" text-anchor="middle" dominant-baseline="middle">Satrana</text>'
        )
        parts.append(
            f'<text x="{x(cx):.1f}" y="{y(iy0-0.3):.1f}" fill="#3a3a3a" font-size="9" '
            f'text-anchor="middle">Îlot D 2,20×2,20</text>'
        )

    # Boussole nord
    cnx, cny = WIDTH - 60, 60
    parts.append(f'<circle cx="{cnx}" cy="{cny}" r="22" fill="#fff" stroke="#1a1a1c" stroke-width="1.2"/>')
    parts.append(f'<polygon points="{cnx},{cny-16} {cnx-6},{cny+4} {cnx},{cny-2} {cnx+6},{cny+4}" fill="#c33"/>')
    parts.append(f'<polygon points="{cnx},{cny+16} {cnx-6},{cny-4} {cnx},{cny+2} {cnx+6},{cny-4}" fill="#1a1a1c"/>')
    parts.append(f'<text x="{cnx}" y="{cny-22}" font-size="11" font-weight="700" text-anchor="middle" fill="#c33">N</text>')

    # Échelle 1 m
    sx0, sxy = 30, HEIGHT - 30
    parts.append(f'<line x1="{sx0}" y1="{sxy}" x2="{sx0 + 5*SCALE}" y2="{sxy}" stroke="#1a1a1c" stroke-width="2"/>')
    for i in range(6):
        parts.append(f'<line x1="{sx0 + i*SCALE}" y1="{sxy - 4}" x2="{sx0 + i*SCALE}" y2="{sxy + 4}" stroke="#1a1a1c" stroke-width="2"/>')
    parts.append(f'<text x="{sx0}" y="{sxy + 18}" font-size="10" fill="#1a1a1c">0</text>')
    parts.append(f'<text x="{sx0 + 5*SCALE}" y="{sxy + 18}" font-size="10" fill="#1a1a1c" text-anchor="end">5 m</text>')

    # Titre + bandeau infos
    parts.append(
        f'<text x="20" y="32" font-size="16" font-weight="700" fill="#1a1a1c">'
        f'Chan Ming POOL — Plan v29 (généré depuis le modèle 3D)</text>'
    )
    parts.append(
        f'<text x="20" y="50" font-size="11" fill="#5a5a5a">'
        f'Surface eau {surf_eau:.1f} m² · 4 bassins + lounge sec · '
        f'origine = angle SO du Grand Bassin · 1 carreau = 1 m</text>'
    )

    parts.append('</svg>')

    # Convertir les \n dans les labels en <tspan>
    svg = "\n".join(parts)
    # Pour les labels multilignes : on a triché en mettant \\n, on les convertit
    svg = re.sub(
        r'<text ([^>]+)>([^<]*\\n[^<]*)</text>',
        lambda m: multiline_text(m.group(1), m.group(2)),
        svg,
    )

    OUT.write_text(svg)
    print(f"✓ Plan SVG généré : {OUT.relative_to(ROOT)}")
    print(f"  Surface eau : {surf_eau:.1f} m² · {WIDTH:.0f}×{HEIGHT:.0f} px")
    return 0


def multiline_text(attrs, content):
    """Transforme un text avec \\n en <text><tspan>...</tspan></text>"""
    # Récupère x dans les attrs
    xm = re.search(r'x="([-\d.]+)"', attrs)
    px = xm.group(1) if xm else "0"
    lines = content.split("\\n")
    tspans = []
    for i, ln in enumerate(lines):
        dy = "0" if i == 0 else "1.2em"
        tspans.append(f'<tspan x="{px}" dy="{dy}">{ln}</tspan>')
    return f'<text {attrs}>{"".join(tspans)}</text>'


if __name__ == "__main__":
    sys.exit(main())
