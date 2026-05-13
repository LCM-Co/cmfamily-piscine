# Piscine Mahajanga — Chan Ming POOL

## Ce projet
Site statique PWA (HTML/CSS/JS pur, zéro build tool, zéro dépendance) pour la gestion de la piscine Chan Ming POOL à Mahajanga, Madagascar.
Hébergement : Vercel. **Branche prod : `main`** (vérifier avec `git branch --show-current` avant push).
Supabase : projet `piscine-2026` (secrets dans `~/.secrets/pool/`).

## Stack
HTML5 + CSS vanilla + JS ES modules. Service worker `sw.js` (PWA offline). Manifest.json. Pas de bundler, pas de framework, pas de npm install.

## Structure
- `index.html` + pages thématiques (dashboard, finance, logistique, decisions, plans, specifications, technique, modele-3d)
- `data/` — fichiers JSON de données (decisions.json, last-sync.json, etc.)
- `scripts/` — JS métier modulaire
- `api/` — intégrations externes
- `assets/` — images, icônes

## Règles impératives
- **Zéro npm/pnpm install** — le projet est intentionnellement sans dépendances.
- Pas de `sudo rm`, pas de suppressions de fichiers sans validation explicite de Lennon.
- Les 35 documents de contexte métier sont dans `~/piscine/docs/`. Lire `~/piscine/docs/08-context-pour-claude.md` en **premier** à chaque session. (Voir `~/piscine/CLAUDE.md` pour le contexte complet du projet.)
- Secrets dans `~/.secrets/pool/` uniquement — jamais dans le repo.
- Soft delete uniquement côté données — jamais de suppressions définitives.
- Modifications CSS/HTML testables directement dans le navigateur avant push.

## Deploy
Push sur `main` = redéployment Vercel automatique (site statique, ~10s). Vérifier avec `vercel ls` après push.

## Outils privilégiés
Utiliser `vercel` CLI et `supabase` CLI locales. Ne pas utiliser les MCP `mcp__claude_ai_*` (OAuth instable en WSL2).
