# Prompt — Mise à jour / fusion d'une cartographie ArchitectViz

## Quand l'utiliser
- Tu as déjà un `<arch>.json` et tu veux le **rafraîchir** après évolution du code.
- Tu as deux analyses séparées (frontend + backend) et tu veux les **fusionner** dans un seul JSON.
- Tu veux **réconcilier** un JSON existant avec une seconde version produite par un autre passage d'analyse.

## Rôle
Tu es un architecte logiciel. Tu reçois un ou deux fichiers JSON conformes au schéma ArchitectViz (`src/schema/architectureSchema.ts`) et tu produis **un seul JSON fusionné** prêt à remplacer le fichier source dans `src/architectures/`.

## Entrées que je te fournis
- `BASE_JSON` : JSON existant (peut contenir des champs `"À confirmer"`, des warnings, du contenu rédigé à la main)
- `NEW_JSON` : nouvelle analyse à intégrer (sortie d'un prompt `analyze-frontend.md` ou `analyze-backend.md`)
- `STRATEGY` : `MERGE_PARTIAL` (NEW = un côté, FE ou BE) ou `MERGE_FULL` (NEW = analyse complète du SI)

## Sortie attendue
**Un seul bloc JSON**, valide, conforme au schéma, sans markdown ni commentaire autour.

---

## Règles de fusion

### Champs scalaires top-level
| Champ | Règle |
|---|---|
| `architecture` | Garder `BASE_JSON.architecture` (nom métier, non auto-déductible) |
| `type` | Élargir si nécessaire : si BASE = `BACKEND` et NEW ajoute un frontend → `FULLSTACK` |
| `version` | Bumper depuis `BASE_JSON.version` selon l'ampleur du diff (patch/minor/major) |
| `lastUpdated` | Date du jour `YYYY-MM-DD` |
| `description` | Garder BASE ; concaténer un complément seulement si NEW apporte une dimension absente (ex. mention du frontend si BASE était backend-only) |

### `layers[]`
- Union des deux listes.
- Si même `name` dans les deux : garder l'entrée de BASE (couleur + description manuelles prévalent).
- Sinon ajouter celle de NEW.

### `components[]`
Pour chaque `id` :

1. **Présent dans BASE et NEW** :
   - Champs auto-déductibles (`technology`, `port`, `version`, `endpoints[]`, `routes[]`, `key_dependencies`, `deployment.platform`, `state_management`, `build_tool`) → **valeur de NEW** prévaut.
   - Champs métier rédigés (`description`, `note`, `deployment.note`, `authentication.note`, `cached_data[].purpose`) → **valeur de BASE** prévaut.
   - Si BASE contient `"À confirmer"` et NEW a une valeur réelle → écraser par NEW.
   - Si NEW et BASE divergent sur un champ critique (`url`, `type`, `layer`) → garder BASE + générer un `warnings[]` `INFO` `"Divergence <id>.<champ> : BASE=X, NEW=Y"`.

2. **Présent dans NEW uniquement** :
   - Ajouter tel quel.
   - Générer un `warnings[]` `INFO` `"Nouveau composant détecté : <id>"`.

3. **Présent dans BASE uniquement** :
   - **Si STRATEGY=MERGE_PARTIAL** : garder (NEW ne couvre qu'un côté, l'absence n'est pas significative).
   - **Si STRATEGY=MERGE_FULL** : garder mais générer `warnings[]` `WARNING` `"Composant <id> potentiellement supprimé du code"` + ajouter `next_steps[]` `"Vérifier l'existence de <id>"`.

### `components[].endpoints[]` et `components[].routes[]`
Match par `(method, path)` :
- Présent des deux côtés → fusionner champ par champ avec la même logique (auto-déductible ← NEW, rédigé ← BASE).
- Présent NEW seul → ajouter.
- Présent BASE seul → garder + warning `WARNING` (en MERGE_FULL).

### `connections[]`
Match par `(from, to)` :
- Fusionner protocole, latency, client, flow (NEW prévaut) ; description et note (BASE prévaut).
- `endpoint_mappings[]` : merge par `(method, frontend_endpoint)` ; même règle.
- Vérifier en sortie que tous les `from`/`to` référencent un `components[].id` existant. Sinon → générer un `warnings[]` `CRITICAL` `"Connection <id> référence un composant inexistant: <ref>"`.

### `flow_summary`
- Recalculer depuis le résultat fusionné. Ne pas reprendre les valeurs des sources.
  - `frontend_routes` = somme des routes de tous les composants `frontend`
  - `backend_endpoints` = somme des `endpoints` de tous les composants `backend`
  - `external_services` = composants où `layer === "External"`
  - `technologies_count` = nombre de techs distinctes mentionnées dans `technology`+`key_dependencies` (déduplication par nom de lib, indépendamment de la version)
  - `user_flow` : reformuler en 1 phrase si l'architecture a changé de forme.

### `warnings[]`
- Union dédupliquée par `(severity, message, component)`.
- Conserver les warnings de BASE non résolus par NEW.
- Ajouter ceux générés par les règles de fusion ci-dessus.

### `validation_checklist`
- Recalculer chaque check :
  - `frontend_endpoints_mapping` : `"✅ VALIDATED"` si chaque `routes[].api_calls` matche un `endpoints[]` côté backend ; sinon liste des `❌` manquants.
  - `authentication_consistency` : `"✅ VALIDATED"` si toutes les `connections.authenticated=true` ciblent un backend avec un bloc `authentication`.
  - Ajouter `data_layer_documented` : `"✅"` si au moins un composant `db` ou `cache` est présent quand `type !== "FRONTEND"`.

### `next_steps`
- Garder les items de BASE non résolus.
- Ajouter ceux découverts pendant la fusion (composants à confirmer, divergences à arbitrer).

---

## Détermination du bump `version`
- **Patch** (`X.Y.Z+1`) : modifications de descriptions, ajout d'1 endpoint ou route mineur, mises à jour de versions de libs.
- **Minor** (`X.Y+1.0`) : nouveau composant, nouvelle connexion, nouveau layer, nouvel external service.
- **Major** (`X+1.0.0`) : changement de `type` global, suppression d'un composant central, refonte d'authentification, changement de protocole majeur.

---

## Anti-patterns à éviter
- Ne jamais perdre les `description`, `note`, `cached_data[].purpose` rédigés à la main dans BASE.
- Ne jamais inventer un `endpoints[]` absent des deux entrées.
- Ne jamais introduire un `type` hors enum.
- Ne jamais laisser un `connections.from`/`to` orphelin.
- Ne jamais écraser une `version` ou `lastUpdated` plus récente par une plus ancienne (sauf instruction explicite).

---

## Format de la réponse
Uniquement le JSON fusionné final. Aucun texte autour. Aucun markdown. Aucun commentaire JSON.
