# Chan Ming POOL — Site de suivi familial

Site web statique pour le suivi du projet de piscine multi-zones à Mahajanga, Madagascar.

## Pages

- `index.html` — Accueil avec chiffres clés et derniers updates
- `modele-3d.html` — Modèle 3D Three.js intégré (iframe vers `viewer/`)
- `specifications.html` — Détail des matériaux, équipements, cotes + Google Forms
- `plans.html` — Plans architecte v29 en PDF
- `decisions.html` — Journal des 30+ décisions validées
- `chantier.html` — Photos du chantier + rendus IA + vues Blender

## Mise à jour rapide

Pour mettre à jour le site (ajouter une photo, corriger une décision, etc.) :

```bash
cd /home/lcm_ubuntu/piscine/site
# éditer le fichier
git add .
git commit -m "update: description"
git push
```

Vercel rebuild automatique en 30 s.

## Activer les commentaires et la prise de décision (Upstash Redis)

Le site embarque deux systèmes natifs branchés sur la même base Redis :

- **Commentaires** (`/api/comments`) — fil de discussion par décision
- **Prise de décision** (`/api/decisions`) — valider, compléter, rectifier,
  archiver, rouvrir, avec audit complet

Pour les activer :

1. Créer un compte sur https://upstash.com (gratuit, 30 secondes)
2. Créer une base **Redis** (free tier — 10 000 commandes/jour suffisent largement)
3. Copier les valeurs `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`
4. Dans Vercel → Project → Settings → Environment Variables, ajouter :
   - `UPSTASH_REDIS_REST_URL` (Production + Preview + Development)
   - `UPSTASH_REDIS_REST_TOKEN` (idem)
   - `ADMIN_SECRET` (optionnel) — pour modérer les commentaires via DELETE
5. Trigger un redéploiement (Vercel → Deployments → Redeploy)

Tant que ces variables ne sont pas définies, le site affiche un message
d'erreur clair dans chaque action expliquant la procédure.

### Comment ça fonctionne côté famille

Sur la page **Décisions**, sous chaque ligne :
- **✅ Valider** → marque la décision comme tranchée (date + nom + note)
- **➕ Compléter** → ajoute une annotation chronologique
- **✏️ Rectifier** → modifie un champ avec motif (rebascule en « En discussion »)
- **🗄 Archiver** → met la décision de côté (motif requis)
- **🔄 Rouvrir** → réactive une décision archivée ou validée
- **💬 Commenter** → fil de discussion ouvert

Pas de mot de passe : seule la famille a l'URL du site. Chaque action demande
votre prénom (mémorisé sur le navigateur après la première saisie) pour
attribuer la trace dans l'audit.

Pas de Google Forms : tout est intégré nativement, sans iframe ni service tiers.

## Synchronisation Redis ↔ fichiers locaux

L'état mutable du projet (validations, compléments, rectifications, audit,
commentaires) vit dans Upstash Redis côté production. Pour pouvoir travailler
dessus en local — et inversement répliquer des changements faits en local sur
le site — il y a un script de sync :

```bash
# Lire l'état du site et l'écrire dans data/
python3 scripts/sync.py pull

# Pousser data/ vers Redis (admin uniquement)
python3 scripts/sync.py push

# Inspecter sans rien modifier
python3 scripts/sync.py status
```

Les fichiers générés/lus :

```
site/data/
├── decisions.json   # état mutable de chaque décision (validations, compléments, audit…)
├── comments.json    # tous les fils de commentaires
└── last-sync.json   # méta : date, mode, compteurs
```

Les **descriptions** des décisions restent dans `decisions.html` (source de
vérité statique, gérée via Git). Redis ne stocke que ce qui change après coup.

### Variables d'environnement nécessaires côté local

- `PISCINE_SITE_URL` — défaut `https://cmfamily-piscine.vercel.app`
- `PISCINE_ADMIN_SECRET` — doit correspondre à `ADMIN_SECRET` côté Vercel.
  Requis pour `push` et pour récupérer les commentaires en bloc avec `pull`.

Le script utilise uniquement la stdlib Python (pas de pip install).

## Cohérence avec le modèle 3D

Le modèle 3D (`viewer/index.html`) est la **source de vérité** des dimensions.
Toutes les pages doivent rester cohérentes avec lui.

À lancer après toute modification du modèle 3D :

```bash
# Vérifie que les pages HTML sont cohérentes avec la 3D
python3 scripts/check-coherence.py

# Régénère le plan 2D SVG depuis les coordonnées de la 3D
python3 scripts/generate-plan-svg.py
```

`check-coherence.py` extrait les coordonnées des bassins depuis le code Three.js,
recalcule surfaces et volumes, et signale les divergences sur les pages
HTML (anciennes valeurs, dimensions imprécises, mentions de « 5 bassins », etc.).
Exit code 0 si OK, 1 sinon.

`generate-plan-svg.py` produit `assets/plan-3d.svg` — un plan 2D vectoriel
montré sur la page Plan, par construction cohérent avec la 3D.

## Hébergement

Site déployé sur Vercel : https://cmfamily-piscine.vercel.app

## Structure

```
site/
├── index.html
├── modele-3d.html
├── specifications.html
├── plans.html
├── decisions.html
├── chantier.html
├── style.css
├── viewer/
│   └── index.html        # Three.js (copie de visualisation/)
└── assets/
    ├── pdf/              # plan-piscine.pdf, plan-v29.pdf
    └── images/
        ├── ai/           # rendus ChatGPT
        ├── blender/      # rendus Cycles
        └── chantier/     # photos chantier (à ajouter)
```
