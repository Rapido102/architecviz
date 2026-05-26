# Section 8 — Flow summary & Warnings

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[7]`](../../extraction-manifest.jsonc)

Sections **calculées** depuis l'état fusionné des sections 1-7. Pas d'extraction directe du code source ici.

## Sortie attendue
```json
{
  "flow_summary": {
    "user_flow": "Browser → REST API → DB + Cache + 3 services externes",
    "technologies_count": 18,
    "backend_endpoints": 42,
    "frontend_routes": 12,
    "external_services": 4
  },
  "warnings": [
    { "severity": "INFO",     "message": "...", "component": "global",      "suggestion": "..." },
    { "severity": "WARNING",  "message": "...", "component": "backend_api", "suggestion": "..." },
    { "severity": "CRITICAL", "message": "...", "component": "...",         "suggestion": "..." }
  ]
}
```

## Calculs `flow_summary`

| Champ | Calcul |
|---|---|
| `technologies_count` | Cardinal de `{nom_lib}` dans `components[].technology` ∪ `components[].key_dependencies`, dédupliqué par **nom** (indépendamment de la version) |
| `backend_endpoints` | Somme de `components[?(@.type=='backend')].endpoints.length` |
| `frontend_routes` | Somme de `components[?(@.type=='frontend')].routes.length` |
| `external_services` | Nombre de `components` où `layer == "External"` |
| `user_flow` | 1 phrase décrivant le chemin utilisateur de bout en bout. Reformuler si l'architecture a changé de forme. **preserve-manual** sinon. |

## Génération `warnings`

Règles **automatiques** appliquées par le pipeline à la fin :

### INFO (informationnel)
- `"Champ <path> au placeholder \"À confirmer\""` — pour chaque champ resté au placeholder après extraction. `component` = id concerné ou `"global"`.
- `"Divergence sur <path> : BASE=X, NEW=Y"` — quand une stratégie `preserve-manual` rejette une nouvelle valeur lors d'un merge.
- `"Nouveau composant détecté : <id>"` — à la création d'un composant en mode `UPDATE`.
- `"Token expiry not documented"` — si `authentication.token_expiry == "À confirmer"`.

### WARNING (risque fonctionnel)
- `"Composant <id> potentiellement supprimé du code"` — en `MERGE_FULL` si un composant BASE est absent de NEW.
- `"No database connection detected"` — si `type` ∈ `{BACKEND, FULLSTACK, MICROSERVICES}` et aucun composant `db`.
- `"Endpoint <method> <path> sans validation"` — pour chaque endpoint POST/PUT/PATCH sans `@Valid`, `ValidationPipe` ou équivalent.

### CRITICAL (bloquant)
- `"Endpoint <method> <path> authenticated=false sur route mutante"` — pour POST/PUT/DELETE en `permitAll()`.
- `"Connection <id> référence un composant inexistant: <ref>"` — si `connections[].from`/`to` ne pointe pas un `components[].id` valide.
- `"Type global incohérent avec components[]"` — ex: `type: "BACKEND"` mais présence d'un composant `frontend`.

## Champs `warnings[].suggestion`
Action concrète, courte, impérative :
- `"Lancer la section <id> du manifeste"`
- `"Documenter <field> dans <file>"`
- `"Vérifier l'existence de <id> dans le code"`
- `"Ajouter @Valid sur le @RequestBody"`

## Validation
- `flow_summary.*_count` : entier ≥ 0
- `warnings` : dédup par `(severity, message, component)`
- `warnings[].severity` : enum `INFO | WARNING | CRITICAL`
- `warnings[].message`, `warnings[].component` : requis

## Merge
- `flow_summary.*` (sauf `user_flow`) → **toujours recalculer** (`compute`)
- `flow_summary.user_flow` → preserve-manual
- `warnings` → dédup par `(severity, message, component)`. Conserver les warnings BASE non résolus. Ajouter les nouveaux.
- `warnings[].suggestion` → preserve-manual
