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

`finalizeBrief` (`output.ts`) écarte les actions sur un signal inconnu ou en double, en garde cinq au plus, rattache à chaque action le code et le lien du signal (jamais un lien écrit par le modèle) et rétablit les prénoms. Un chiffre absent des données envoyées, ou un pseudonyme inconnu, est noté dans `ai_brief.warnings` sans bloquer le brief : c'est la liste à relire pendant la bêta.

## Statuts de `ai_brief`

- `empty` : aucun signal ce jour-là, pas d'appel au modèle.
- `signals_only` : IA coupée ou sans clé ; l'écran montre les signaux bruts.
- `pending`, puis `submitted` : en attente du modèle.
- `ready` : brief validé dans `content`.
- `failed` : refus, erreur ou réponse hors format après les deux essais ; l'écran montre les signaux bruts.

La table est sous RLS comme les autres tables métier (migration `0004_ai_brief_rls`). Les jobs ne lisent en multi-organisation que le routage (identifiants, statuts, batch) ; tout le reste passe par `withTenant`.

## Configuration (worker)

- `ANTHROPIC_API_KEY` : sans elle, les briefs restent en `signals_only`.
- `AI_BRIEF_ENABLED=false` : coupe l'IA sans retirer la clé.
- `AI_BRIEF_MODEL` : `claude-opus-5-5` par défaut ; `claude-sonnet-5-5` coûte deux fois moins cher.

Les tokens de chaque réponse gardée sont stockés (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) pour mesurer le coût réel par commerçant.

## Limites actuelles

Le socle ne stocke pas encore certaines données ; les signaux concernés restent muets plutôt que de se tromper :

- pas de stock suivi : S1 et S2 ne sortent pas ;
- pas de pubs Meta : P1 à P5 ne sortent pas, ni R1 (produit en perte), qui a besoin de la dépense pub ;
- pas de frais de livraison ni de retour par produit : comptés à zéro, ce qui surestime la marge utilisée pour classer C2 ;
- pas de transporteur : L2 ne juge que les gouvernorats, déduits du champ ville (`toGovernorate`) ;
- pas d'objectif de confirmation par produit : le seuil par défaut s'applique.

Aucune route d'API n'expose encore le brief : elle viendra avec l'écran Actions, derrière l'authentification.
