#!/usr/bin/env python3
"""
Synchronisation bidirectionnelle entre Redis (production Vercel) et les
fichiers locaux du dépôt site/data/.

Usage :
    python3 scripts/sync.py pull       # tire l'état Redis dans data/
    python3 scripts/sync.py push       # pousse data/ vers Redis (admin)
    python3 scripts/sync.py status     # affiche un résumé sans toucher

Variables d'environnement requises :
    PISCINE_SITE_URL   (def. https://cmfamily-piscine.vercel.app)
    PISCINE_ADMIN_SECRET   (pour push et pull-comments) — doit correspondre
                            à ADMIN_SECRET configuré côté Vercel.

Fichiers générés/lus dans site/data/ :
    decisions.json    → { D01: { status, validation, complements, ... }, ... }
    comments.json     → { D01: [ { id, name, body, status, created_at, ... }, ... ], ... }
    last-sync.json    → métadonnées (date, mode, counts)

Le script ne touche jamais aux fichiers HTML — la description originale
des décisions reste la source de vérité statique. Redis garde uniquement
l'état mutable (validations, compléments, rectifications, audit, commentaires).
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DECISIONS_FILE = DATA_DIR / "decisions.json"
COMMENTS_FILE = DATA_DIR / "comments.json"
META_FILE = DATA_DIR / "last-sync.json"

DEFAULT_URL = os.environ.get("PISCINE_SITE_URL", "https://cmfamily-piscine.vercel.app").rstrip("/")
ADMIN_SECRET = os.environ.get("PISCINE_ADMIN_SECRET", "")


def http(method, path, body=None, admin=False, timeout=20):
    """Petit wrapper urllib pour ne pas avoir de dépendance externe."""
    url = DEFAULT_URL + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if admin:
        if not ADMIN_SECRET:
            sys.exit("ERREUR : PISCINE_ADMIN_SECRET non défini dans l'environnement.")
        headers["x-admin-secret"] = ADMIN_SECRET
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            payload = {"error": str(e)}
        return e.code, payload
    except urllib.error.URLError as e:
        sys.exit(f"ERREUR réseau ({url}) : {e}")


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def read_json(path, default=None):
    if not path.exists():
        return default if default is not None else {}
    return json.loads(path.read_text() or "{}")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ─── Pull : Redis → local ───
def cmd_pull():
    ensure_data_dir()
    print(f"PULL depuis {DEFAULT_URL}")

    code, body = http("GET", "/api/decisions")
    if code != 200:
        sys.exit(f"  ✗ /api/decisions a renvoyé {code} : {body.get('error', body)}")
    states = body.get("states", {})
    write_json(DECISIONS_FILE, states)
    print(f"  ✓ {len(states)} décision(s) → {DECISIONS_FILE.relative_to(ROOT)}")

    # Comments : nécessite admin
    if not ADMIN_SECRET:
        print("  ⚠ PISCINE_ADMIN_SECRET non défini — commentaires non synchronisés.")
        print("    (les commentaires nécessitent le secret admin pour être listés en bloc)")
        threads = {}
    else:
        code, body = http("GET", "/api/comments", admin=True)
        if code != 200:
            print(f"  ✗ /api/comments → {code} : {body.get('error', body)}")
            threads = {}
        else:
            threads = body.get("threads", {})
            write_json(COMMENTS_FILE, threads)
            n_msgs = sum(len(v) for v in threads.values())
            print(f"  ✓ {len(threads)} fil(s), {n_msgs} message(s) → {COMMENTS_FILE.relative_to(ROOT)}")

    write_json(META_FILE, {
        "mode": "pull",
        "date": now_iso(),
        "url": DEFAULT_URL,
        "decisions_count": len(states),
        "comments_threads": len(threads),
        "comments_total": sum(len(v) for v in threads.values()),
    })
    print("✓ Pull terminé.")


# ─── Push : local → Redis ───
def cmd_push():
    if not ADMIN_SECRET:
        sys.exit("ERREUR : PISCINE_ADMIN_SECRET requis pour push.")
    print(f"PUSH vers {DEFAULT_URL}")

    states = read_json(DECISIONS_FILE, {})
    if not states:
        print("  ⚠ data/decisions.json vide ou absent — push de l'état décision sauté.")
    else:
        code, body = http("PUT", "/api/decisions", body={"states": states}, admin=True)
        if code != 200:
            sys.exit(f"  ✗ PUT /api/decisions → {code} : {body.get('error', body)}")
        print(f"  ✓ {body.get('written', '?')} décision(s) écrite(s) sur Redis")

    threads = read_json(COMMENTS_FILE, {})
    if not threads:
        print("  ⚠ data/comments.json vide ou absent — push des commentaires sauté.")
    else:
        code, body = http("PUT", "/api/comments", body={"threads": threads}, admin=True)
        if code != 200:
            sys.exit(f"  ✗ PUT /api/comments → {code} : {body.get('error', body)}")
        print(f"  ✓ {body.get('written', '?')} fil(s) écrit(s) sur Redis")

    write_json(META_FILE, {
        "mode": "push",
        "date": now_iso(),
        "url": DEFAULT_URL,
        "decisions_count": len(states),
        "comments_threads": len(threads),
    })
    print("✓ Push terminé.")


# ─── Status ───
def cmd_status():
    ensure_data_dir()
    print(f"URL cible : {DEFAULT_URL}")
    print(f"ADMIN_SECRET configuré : {'oui' if ADMIN_SECRET else 'NON (push impossible)'}")
    print()
    print("Local :")
    if DECISIONS_FILE.exists():
        states = read_json(DECISIONS_FILE, {})
        print(f"  decisions.json — {len(states)} décision(s)")
        by_status = {}
        for s in states.values():
            st = s.get("status") or "—"
            by_status[st] = by_status.get(st, 0) + 1
        for k, v in sorted(by_status.items()):
            print(f"     {k:<12} : {v}")
    else:
        print("  decisions.json — absent")
    if COMMENTS_FILE.exists():
        threads = read_json(COMMENTS_FILE, {})
        n_msgs = sum(len(v) for v in threads.values())
        print(f"  comments.json — {len(threads)} fil(s), {n_msgs} message(s)")
    else:
        print("  comments.json — absent")
    if META_FILE.exists():
        meta = read_json(META_FILE, {})
        print(f"  Dernière sync : {meta.get('mode', '?')} le {meta.get('date', '?')}")

    print()
    print("Distant :")
    code, body = http("GET", "/api/decisions")
    if code == 200:
        print(f"  /api/decisions → {len(body.get('states', {}))} décision(s)")
    else:
        print(f"  /api/decisions → {code} : {body.get('error', body)}")
    if ADMIN_SECRET:
        code, body = http("GET", "/api/comments", admin=True)
        if code == 200:
            t = body.get("threads", {})
            n_msgs = sum(len(v) for v in t.values())
            print(f"  /api/comments → {len(t)} fil(s), {n_msgs} message(s)")
        else:
            print(f"  /api/comments → {code} : {body.get('error', body)}")


def main():
    ap = argparse.ArgumentParser(description="Sync Redis ↔ data/")
    ap.add_argument("mode", choices=["pull", "push", "status"])
    args = ap.parse_args()
    if args.mode == "pull":
        cmd_pull()
    elif args.mode == "push":
        cmd_push()
    elif args.mode == "status":
        cmd_status()


if __name__ == "__main__":
    main()
