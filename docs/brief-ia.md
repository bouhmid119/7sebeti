# Brief IA de nuit

Chaque matin, chaque commerçant reçoit au plus cinq actions à mener, rédigées en français. Le principe : **le code calcule, l'IA explique**. Les signaux (`packages/domain/src/signals`) sont calculés par des règles testées ; Claude ne fait que les classer et les formuler, sans jamais inventer un chiffre.

## Déroulé (heure de Tunis)

| Heure | Job pg-boss | Ce qu'il fait |
|---|---|---|
| 03:00 | `ai-brief-prepare` | Calcule les signaux de chaque organisation, les stocke dans `ai_brief`, envoie un seul batch à Claude (Batch API, moitié prix). |
| toutes les 10 min | `ai-brief-collect` | Récupère les résultats des batchs terminés, valide et enregistre les briefs. |
| 07:00 | `ai-brief-fallback` | Annule ce que le batch n'a pas rendu et appelle Claude directement, une fois. |

Les trois jobs sont idempotents : relancer `prepare` le même jour ne recalcule ni ne renvoie rien. Un brief reçoit au plus deux réponses du modèle (batch, puis rattrapage).

## Ce qui part chez Claude

`prepareBrief` (`packages/domain/src/brief/payload.ts`) construit le message par liste blanche :

- par signal : code, titre, sujet (produit, pub, zone, transporteur), chiffres déjà formatés en français, seuil, argent en jeu ;
- les agents de confirmation deviennent « Agent A », « Agent B »… ; la correspondance reste dans `ai_brief.pseudonyms` et les vrais prénoms sont rétablis après la réponse ;
- jamais de nom, téléphone ou ville de client, d'identifiant ni de lien ;
- les 8 signaux qui pèsent le plus, le reste est compté (`signauxNonDetailles`).

La consigne système (`prompt.ts`) est fixe et mise en cache. Le modèle répond dans un format JSON imposé (`BRIEF_OUTPUT_SCHEMA`).

## Contrôles sur la réponse

`finalizeBrief` (`output.ts`) écarte les actions sur un signal inconnu ou en double, en garde cinq au plus, rattache à chaque action le code et le lien du signal (jamais un lien écrit par le modèle) et rétablit les prénoms. Une réponse dont aucune action n'est retenue alors qu'il y a des signaux est refusée : le brief passe en `failed` et l'écran montre les phrases fixes. Un chiffre absent des données envoyées, ou un pseudonyme inconnu, est noté dans `ai_brief.warnings` sans bloquer le brief : c'est la liste à relire pendant la bêta.

## Statuts de `ai_brief`

- `empty` : aucun signal ce jour-là, pas d'appel au modèle.
- `signals_only` : IA coupée ou sans clé ; l'écran montre le brief en phrases fixes.
- `pending`, puis `submitted` : en attente du modèle ; en attendant, phrases fixes.
- `ready` : brief validé dans `content`.
- `failed` : refus, erreur ou réponse hors format après les deux essais ; phrases fixes.

La table est sous RLS comme les autres tables métier (migration `0004_ai_brief_rls`). Les jobs ne lisent en multi-organisation que le routage (identifiants, statuts, batch) ; tout le reste passe par `withTenant`.

## Configuration (worker)

- `ANTHROPIC_API_KEY` : sans elle, les briefs restent en `signals_only`.
- `AI_BRIEF_ENABLED=false` : coupe l'IA sans retirer la clé.
- `AI_BRIEF_MODEL` : `claude-opus-5-5` par défaut ; `claude-sonnet-5-5` coûte deux fois moins cher. Le test de qualité de MOH-11 vise `claude-haiku-5-5`.

## Comparer Haiku aux phrases fixes (MOH-11)

Quarante boutiques fictives, calculées par `computeSignals` comme en production, puis rédigées deux fois : phrases fixes, puis Haiku 5.5 en batch. Aucune donnée réelle. Le rapport s’affiche dans le terminal, pas dans le repo.

```bash
set -a; . ./.env; set +a
pnpm --filter @7sebeti/worker eval-brief          # 40 cas, claude-haiku-5-5
EVAL_BRIEF_COUNT=10 pnpm --filter @7sebeti/worker eval-brief
```

`ANTHROPIC_API_KEY` est obligatoire. `AI_BRIEF_MODEL` change le modèle. `EVAL_BRIEF_DIRECT=1` appelle le modèle un par un (plus cher, utile si le batch tarde). Relis le tableau : un avertissement « chiffre absent des données » ou un brief refusé pèse contre Haiku.

Les tokens de chaque réponse gardée sont stockés (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) pour mesurer le coût réel par commerçant.

## Limites actuelles

Le socle ne stocke pas encore certaines données ; les signaux concernés restent muets plutôt que de se tromper :

- pas de stock suivi : S1 et S2 ne sortent pas ;
- pas de pubs Meta : P1 à P5 ne sortent pas, ni R1 (produit en perte), qui a besoin de la dépense pub ;
- pas de frais de livraison ni de retour par produit : comptés à zéro, ce qui surestime la marge utilisée pour classer C2 ;
- pas de transporteur : L2 ne juge que les gouvernorats, déduits du champ ville (`toGovernorate`) ;
- pas d'objectif de confirmation par produit : le seuil par défaut s'applique.

## Sans le modèle : phrases fixes

Quand le texte de Claude manque (pas de clé, IA coupée, réponse pas encore arrivée ou en échec), `briefFromRules` (`packages/domain/src/brief/rules.ts`) rédige le brief avec une phrase par code de signal, à partir des mêmes chiffres formatés que le payload : cinq actions au plus, deux au plus par code pour que trois agents en retard ne cachent pas une pub à couper. Rien n'est calculé : les chiffres bruts servent seulement à choisir la tournure (stock sans vente, budget déjà au plafond), et les tests vérifient qu'aucun chiffre affiché n'est absent des données. Le commerçant a donc toujours un brief lisible, et la bêta peut démarrer sans clé Anthropic.

`presentBrief` (`view.ts`) choisit ce qui s'affiche : le texte de Claude s'il est `ready`, sinon les phrases fixes, puis les autres signaux du jour (formatés, vrais noms, lien).

## API

Toutes les routes demandent une session et l'en-tête `x-organization-id`, et passent par `withTenant`.

| Route | Rôles | Rend |
|---|---|---|
| `GET /api/briefs/today` | owner, admin, viewer | le brief du jour dans le fuseau de l'organisation (`BriefView`), 404 avant le job de 03:00 |
| `GET /api/briefs/:date` | owner, admin, viewer | le brief d'un jour (AAAA-MM-JJ) |
| `GET /api/briefs?limit=14` | owner, admin, viewer | l'historique (date, statut, nombre de signaux), 60 au plus |
| `PUT /api/briefs/:id/signals/:signal/feedback` | owner, admin | enregistre `{ "feedback": "done" \| "not_relevant" \| null, "shownAs"?: "ai" \| "rules" \| "signal" }` |

Les agents n'ont pas accès au brief : il juge aussi leurs résultats (C3, C4). La réponse ne contient ni payload, ni pseudonymes, ni avertissements, ni tokens. Schémas : `BriefView`, `BriefHistoryItem`, `BriefFeedbackRequest` dans `@7sebeti/contracts`.

## Retours du commerçant

Sur chaque signal, le commerçant peut dire « fait » (`done`) ou « pas pertinent » (`not_relevant`). Une ligne par brief et par signal dans `ai_brief_feedback` (migrations `0005` et `0006`), avec le code du signal et ce que le commerçant avait sous les yeux (`shown_as`) : le texte de Claude (`ai`), une phrase fixe (`rules`) ou la simple carte d'un signal sans action rédigée (`signal`). C'est la mesure de la bêta, signal par signal, et entre texte de Claude et phrases fixes. Le front envoie `shownAs` (le brief a pu passer `ready` entre l'affichage et le clic) ; sans lui, l'API le déduit du brief tel qu'il s'affiche au moment du retour. La politique RLS vérifie aussi, à l'écriture, que le brief visé appartient à l'organisation.
