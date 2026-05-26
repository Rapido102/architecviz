# Section 2 — Layers

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[1]`](../../extraction-manifest.jsonc)

Couches structurelles du canvas. **Section statique** dans 99 % des cas.

## Sortie attendue
```json
[
  { "name": "Frontend", "color": "#E3F2FD", "description": "Couche présentation — interfaces utilisateur, SPA, MFE" },
  { "name": "Backend",  "color": "#FFF3E0", "description": "Couche métier — API REST, services, traitements" },
  { "name": "Data",     "color": "#F3E5F5", "description": "Couche persistance — bases de données, cache, files" },
  { "name": "External", "color": "#E8F5E9", "description": "Services externes / tiers — APIs partenaires, IAM, monitoring" }
]
```

## Méthode
- En `CREATE` : retourner le default ci-dessus tel quel.
- En `UPDATE` : préserver l'existant. **Ajouter** une couche uniquement si un composant des sections 3-6 demande un `layer` qui n'existe pas (ex: `Gateway`, `Mobile`, `AI/ML`).
  - Nouvelle couche : choisir un hex pastel `#RRGGBB` distinct des existants.
  - Description : 1 phrase métier.

## Validation
- Dédup par `name`.
- `color` : `^#[0-9A-Fa-f]{6}$`
- `name`, `description` : requis
