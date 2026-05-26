# Section 1 — Identité

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[0]`](../../extraction-manifest.jsonc)

Extraire les champs top-level du SI.

## Sortie attendue
```json
{
  "architecture": "...",
  "type": "FULLSTACK | BACKEND | FRONTEND | MICROSERVICES | MONOLITH | DATA | OTHER",
  "version": "X.Y.Z",
  "lastUpdated": "YYYY-MM-DD",
  "description": "..."
}
```

## Méthode

### `architecture`
| Source | Règle |
|---|---|
| `package.json` → `name` | Slug technique → humaniser |
| `pom.xml` → `<artifactId>` | idem |
| `pyproject.toml` → `tool.poetry.name` ou `project.name` | idem |
| `README.md` → premier H1 | Nom métier court (préféré) |

Sortir un **nom métier court** (ex: `"CEGeC"`, `"Portail Client"`), pas le slug technique du repo.

### `type`
Déduit de la composition future de `components[]` :
- `frontend` seul → `FRONTEND`
- `backend` seul → `BACKEND`
- `frontend` + `backend` → `FULLSTACK`
- ≥ 3 composants backend distincts → `MICROSERVICES`
- composants `etl`/`batch` dominants → `DATA`
- sinon → `OTHER`

En extraction par section, `type` peut être réévalué par le pipeline après la section 8.

### `version`
- `CREATE` → `"0.1.0"`
- `UPDATE` → bumper depuis l'existant :
  - **patch** (`X.Y.Z+1`) : descriptions, versions de libs, 1-2 endpoints
  - **minor** (`X.Y+1.0`) : nouveau composant / connexion / layer
  - **major** (`X+1.0.0`) : changement de `type`, refonte d'auth, refonte topologique

### `lastUpdated`
Date du jour au format `YYYY-MM-DD`.

### `description`
| Source | Règle |
|---|---|
| `package.json` → `description` | Reformuler en métier |
| `pom.xml` → `<description>` | idem |
| `README.md` → 1er paragraphe après H1 | idem |

Reformuler en **1-2 phrases métier** (« à quoi sert ce SI ? »). **Ne PAS mentionner la stack**. Pas de jargon technique.

## Validation
- `architecture` : string, 2-60 caractères
- `type` : enum strict
- `version` : `^\d+\.\d+\.\d+$`
- `lastUpdated` : `^\d{4}-\d{2}-\d{2}$`
- `description` : string, 10-400 caractères
