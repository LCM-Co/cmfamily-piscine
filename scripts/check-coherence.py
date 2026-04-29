#!/usr/bin/env python3
"""
Vérifie la cohérence des dimensions citées sur les pages HTML du site
avec la source de vérité géométrique du modèle 3D Three.js (viewer/index.html).

À lancer après toute modification du modèle 3D :
    python3 scripts/check-coherence.py

Sortie : liste des divergences (dimensions, profondeurs, surface, volume).
Exit code 0 si tout est cohérent, 1 sinon.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWER = ROOT / "viewer" / "index.html"

# Pages à auditer
PAGES = [
    ROOT / "index.html",
    ROOT / "specifications.html",
    ROOT / "modele-3d.html",
    ROOT / "decisions.html",
    ROOT / "plans.html",
    ROOT / "chantier.html",
]

ZONE_RE = re.compile(
    r"(GB|PLAGE|MB|COULOIR):\s*\{\s*x0:\s*([\d.]+),\s*y0:\s*([\d.]+),\s*x1:\s*([\d.]+),\s*y1:\s*([\d.]+),\s*depth:\s*([\d.]+)"
)


def extract_truth():
    src = VIEWER.read_text()
    zones = {}
    for m in ZONE_RE.finditer(src):
        name, x0, y0, x1, y1, depth = m.group(1), *map(float, m.groups()[1:])
        w = round(x1 - x0, 3)
        l = round(y1 - y0, 3)
        zones[name] = {"w": w, "l": l, "depth": depth, "area": round(w * l, 2)}
    total_area = sum(z["area"] for z in zones.values())
    total_volume = round(sum(z["area"] * z["depth"] for z in zones.values()), 1)
    return {
        "zones": zones,
        "total_area": round(total_area, 1),
        "total_volume": total_volume,
    }


def fr(n):
    """Formatte un nombre en convention francophone (virgule)."""
    if n == int(n):
        return str(int(n))
    return f"{n:.2f}".replace(".", ",").rstrip("0").rstrip(",")


def check(truth):
    issues = []
    gb, plage, mb, couloir = truth["zones"]["GB"], truth["zones"]["PLAGE"], truth["zones"]["MB"], truth["zones"]["COULOIR"]

    # Dimensions canoniques attendues, formatées
    canon = {
        "GB":      f"{fr(gb['w'])}×{fr(gb['l'])}",
        "PLAGE":   f"{fr(plage['w'])}×{fr(plage['l'])}",
        "MB":      f"{fr(mb['w'])}×{fr(mb['l'])}",
        "COULOIR": f"{fr(couloir['w'])}×{fr(couloir['l'])}",
    }
    canon_loose = {  # match plus tolérant (avec ou sans virgule)
        "GB":      [f"{gb['w']:.2f}".replace(".", ","), f"{gb['l']:.2f}".replace(".", ",")],
        "PLAGE":   [f"{plage['w']:.2f}".replace(".", ","), f"{plage['l']:.2f}".replace(".", ",")],
    }

    # Surfaces et volumes canoniques
    expected_area = truth["total_area"]
    expected_volume = truth["total_volume"]

    # Patterns suspects à débusquer dans tout le HTML
    suspect_patterns = [
        # Anciennes valeurs erronées
        (re.compile(r"7\s*[×x]\s*8\s*m\b", re.I), "7×8 m (devrait être 7,04×7,87)"),
        (re.compile(r"3\s*[×x]\s*8\s*m\b", re.I), "3×8 m (devrait être 3,24×7,87)"),
        (re.compile(r"\b5\s*bassins\b", re.I), "« 5 bassins » (la réalité est 4 bassins + lounge sec)"),
        (re.compile(r"7,04\s*[×x]\s*8,00"), "GB 7,04×8,00 (devrait être 7,04×7,87)"),
        (re.compile(r"3,24\s*[×x]\s*8,00"), "Plage 3,24×8,00 (devrait être 3,24×7,87)"),
        (re.compile(r"daybed[^<]{0,40}2\s*[×x]\s*1\s*m", re.I), "daybed 2×1 m (devrait être 2,20×1,20)"),
    ]

    for page in PAGES:
        if not page.exists():
            continue
        text = page.read_text()
        for pattern, desc in suspect_patterns:
            for m in pattern.finditer(text):
                line = text[: m.start()].count("\n") + 1
                issues.append(f"{page.name}:{line} — {desc}")

    return issues, canon, expected_area, expected_volume


def main():
    if not VIEWER.exists():
        print(f"ERREUR : {VIEWER} introuvable", file=sys.stderr)
        return 2

    truth = extract_truth()
    issues, canon, area, volume = check(truth)

    print(f"=== Source de vérité (extraite de {VIEWER.relative_to(ROOT)}) ===")
    for name, z in truth["zones"].items():
        print(f"  {name:<8} : {fr(z['w'])} × {fr(z['l'])} m, profondeur {fr(z['depth'])} m, surface {z['area']} m²")
    print(f"  Surface totale : {area} m²")
    print(f"  Volume total   : {volume} m³")
    print()

    if issues:
        print(f"=== {len(issues)} divergence(s) détectée(s) ===")
        for i in issues:
            print(f"  ✗ {i}")
        return 1

    print("✓ Toutes les pages sont cohérentes avec le modèle 3D.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
