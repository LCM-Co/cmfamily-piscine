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

## Configurer les Google Forms

Dans `specifications.html`, remplacer les trois `PLACEHOLDER_FORM_ID_X` par les
URLs `src` de tes Google Forms (Envoyer → onglet `</>` → copier le `src`).

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
