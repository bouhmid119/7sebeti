# Travailler sur 7sebeti avec Cursor

## Ce que paient les crédits Cursor

Les crédits Claude d'un forfait Cursor (Pro, Pro+, Ultra) ne servent que dans Cursor : l'agent (Cmd+I), le chat et la commande `agent` du CLI Cursor. Ils sont décomptés au prix API du modèle choisi. Le suivi est sur [cursor.com/dashboard/spending](https://cursor.com/dashboard/spending).

Ils ne paient ni Claude Code (extension ou terminal) ni claude.ai : Claude Code se paie avec un abonnement Claude ou une clé API Anthropic.

Choix du modèle dans le sélecteur de l'agent (Cmd+/ pour changer) :

| Modèle | Prix par million de tokens (entrée / sortie) | Usage |
|---|---|---|
| Claude Sonnet 5.5 | 2 $ / 10 $ | par défaut |
| Claude Opus 5.5 | 4 $ / 20 $ | tâches difficiles (migration, RLS, refonte) |
| Claude Fable 5.1 | 10 $ / 50 $ | à éviter : cinq fois Opus, et Anthropic garde les échanges 30 jours même en Privacy Mode |

En mode agent, chaque appel d'outil renvoie l'historique : une longue session sur Opus consomme vite le forfait. Mieux vaut une conversation par tâche.

## 1. Régler Cursor (une fois)

1. Se connecter avec le compte Cursor qui porte les crédits.
2. **Privacy Mode** : Cursor Settings (Cmd+Shift+J) > General > Privacy Mode, activé. Obligatoire ici : le code traite des données de clients, et sans ce mode Cursor peut garder et réutiliser le code.
3. Cursor Settings > Agents > Third-Party Imports : laisser activé « Include third-party Plugins, Skills, and other configs ». C'est ce réglage qui fait lire `CLAUDE.md` à l'agent.

## 2. Un dossier à soi

Ne pas ouvrir `~/Documents/7sebeti/v2` : c'est le dossier de la session Claude du fil « Audit v1 et architecture » sur le Mac, et un changement de branche y casserait son travail. Cloner à côté :

```bash
cd ~/Documents/7sebeti
git clone https://github.com/bouhmid119/7sebeti.git v2-cursor
cd v2-cursor
git checkout ia-actions   # main n'a que le commit initial tant que les PR ne sont pas fusionnées
```

Puis File > Open Folder > `v2-cursor`. Pour lire la v1 à côté : File > Add Folder to Workspace > `v1-hsebeti` (lecture seulement).

Pour modifier le code : une branche à soi (`git checkout -b ahmed/sujet`), poussée et proposée en PR. Les branches `v2-*` et `ia-*` sont celles des fils Claude du projet : ne pas y pousser.

## 3. Vérifier que l'agent connaît les règles

- Customize (barre latérale) > Rules : `CLAUDE.md` et `AGENTS.md` doivent apparaître.
- Test : demander à l'agent « Quelles sont les règles sur l'argent et les données clients dans ce repo ? ». Il doit parler d'entiers en millimes, de `withTenant`, du téléphone en HMAC.
- `.cursorignore` ferme les fichiers `.env` et les clés à l'agent (le `.gitignore` ne bloque que l'indexation). Son terminal peut toujours les lire : ne jamais lui demander d'afficher un `.env`, ni coller un secret dans le chat.

## 4. Extensions

Cursor propose les extensions de `.vscode/extensions.json` : Biome (formatage à l'enregistrement), Tailwind CSS, Vitest et Claude Code. Les accepter. Si un formatage Prettier importé de VS Code prend le dessus, retirer le réglage `editor.defaultFormatter` par langage des réglages utilisateur.

L'extension Claude Code est facultative : elle utilise un compte Claude, pas les crédits Cursor.

## 5. Lancer le projet en local

Utile pour que l'agent lance les tests. Il faut Docker Desktop pour PostgreSQL.

```bash
corepack enable
pnpm install
docker compose up -d
cp .env.example .env          # ENCRYPTION_KEY, DATA_MASTER_KEY, BETTER_AUTH_SECRET : openssl rand -base64 32
set -a; . ./.env; set +a
pnpm db:migrate
pnpm dev                      # web :5173, api :4000, worker
```

`curl localhost:4000/health` doit répondre `"db":"ok"`. Avant un commit : `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, dans un terminal où `.env` est exporté (sinon les tests RLS et API sont sautés).

## 6. Connecteurs (facultatif)

Notion dans l'agent de Cursor : ajouter dans `~/.cursor/mcp.json`

```json
{ "mcpServers": { "notion": { "url": "https://mcp.notion.com/mcp" } } }
```

puis Customize > MCP > Notion, et se connecter. Aucun jeton ne va dans le repo.
