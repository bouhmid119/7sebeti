# Sécurité des données

Ce document décrit ce qui est en place dans le code. Hébergement : Azure France Central pendant la bêta, puis Scaleway Paris (`docs/deploy.md`). Proxy Cloudflare désactivé devant l'API, e-mails par Resend, sauvegardes chez OVH (décisions du 8 octobre 2026, page Notion « Design d'architecture », section 1).

## Authentification

- Better Auth, e-mail et mot de passe (10 caractères minimum), sessions en cookie `httpOnly`, `SameSite=Lax`, `Secure` en production. `app.7sebeti.com` et `api.7sebeti.com` sont le même site, donc le cookie suit les appels du front.
- Double authentification TOTP disponible (`/api/auth/two-factor/*`). La rendre obligatoire pour les propriétaires est la prochaine étape.
- Vérification de l'adresse à l'inscription et mot de passe oublié par e-mail (Resend, `apps/api/src/lib/mailer.ts`). Resend garde ses données aux États-Unis : un e-mail ne contient que l'adresse du marchand et un lien, jamais une donnée de client. Sans `RESEND_API_KEY` (dev, CI), l'e-mail n'est pas envoyé et seul son sujet est journalisé ; la clé est obligatoire en production.
- Routes : `/api/auth/*` (Better Auth), `GET /api/me`, `POST /api/organizations`, et toute route métier exige l'en-tête `x-organization-id` d'une organisation dont l'utilisateur est membre.

## Connexion à la base

- Base managée en accès privé (réseau virtuel), joignable seulement depuis la VM.
- TLS toujours vérifié : l'API, le worker et les migrations contrôlent le certificat de la base (`DATABASE_SSL=verify-full` avec les autorités publiques du système, ou `DATABASE_CA_CERT_FILE` pour un fournisseur à CA privée) ; la sauvegarde aussi (`PGSSLMODE=verify-full`). Un certificat qui ne correspond pas est refusé.

## Isolation entre marchands (RLS)

- Toutes les tables qui portent `organization_id` sont sous row-level security (migration `0002_rls.sql`).
- Le code métier passe par `withTenant(db, organizationId, fn)` : la transaction prend le rôle `app_rw` (ni propriétaire des tables ni `BYPASSRLS`) et fixe `app.org_id`. Sans contexte, une requête renvoie zéro ligne ; une écriture vers une autre organisation est refusée.
- Avant le choix d'une organisation, `withUser` ne laisse voir que les adhésions de l'utilisateur.
- L'utilisateur de connexion reste propriétaire des tables : c'est lui qui route les webhooks, crée les organisations et fera les purges et dumps. Quand l'hébergement sera choisi, on séparera les identifiants de connexion (`app_rw` en login pour l'API, propriétaire réservé aux migrations).
- Un test en CI échoue si une table de `public` n'est pas sous RLS sans figurer dans `RLS_EXEMPT_TABLES` (tables d'authentification).

## Chiffrement

| Clé | Où | Sert à |
|---|---|---|
| `ENCRYPTION_KEY` (trousseau) | variable d'environnement | jetons OAuth des intégrations |
| `DATA_MASTER_KEY` (trousseau) | variable d'environnement | envelopper la clé de données de chaque organisation |
| clé de données de l'organisation | `organization.data_key_encrypted`, enveloppée | noms des clients, contenus bruts des webhooks, HMAC des téléphones |
| clé publique `age` | serveur de sauvegarde | chiffrer les dumps (le serveur ne peut pas les relire) |

- Format d'un trousseau : `v1:<base64>;v2:<base64>`. La dernière clé chiffre, toutes déchiffrent : on fait tourner une clé en ajoutant une version, puis on rechiffre et on retire l'ancienne.
- Supprimer la clé de données d'une organisation rend ses données chiffrées illisibles, une fois expirées les sauvegardes qui la contiennent encore (environ 4 semaines).

## Données des clients finaux

- Téléphone : jamais stocké en clair. On garde un HMAC propre à l'organisation (pour reconnaître un client récurrent) et les 3 derniers chiffres (pour l'affichage).
- Nom : chiffré avec la clé de l'organisation.
- Contenu brut des webhooks : compressé puis chiffré. Un contenu identique au dernier reçu pour la même commande n'est pas re-stocké : seul un compteur avance (`external_object_state`).

## Webhooks

- Secret Converty dans l'URL, stocké haché (SHA-256), comparé en temps constant, jamais écrit dans les logs (le journal d'accès n'écrit que le motif de route).
- Le contenu et le job de traitement sont enregistrés dans la même transaction ; 500 si l'enregistrement échoue, pour que Converty réessaie.

## Sauvegardes

Scripts dans `ops/backup/`. En production, le service `backup` du compose (`ops/deploy/compose.yml`) lance `backup.sh` chaque nuit à 02:30 UTC :

- `backup.sh`, chaque nuit : `pg_dump` compressé, chiffré avec la clé publique `age`, envoyé dans OVH Object Storage en France, dans un bucket à verrouillage d'objets (un dump ne peut pas être supprimé ni modifié pendant sa rétention, même avec nos identifiants). Le dump du dimanche va dans `weekly/`. Règles de cycle de vie : `daily/` 8 jours, `weekly/` 29 jours.
- `restore-check.sh`, chaque mois : restaure le dernier dump sur une base jetable **dans la même région UE** (jamais sur un runner GitHub), puis compare les comptages avec la production (`compare-counts.sh`). Une sauvegarde jamais restaurée ne compte pas.
- La clé privée `age` reste hors ligne, chez Ahmed et Dali.

### Remise en service

1. Créer une base vide dans la région, puis le rôle `app_rw` (le script le fait).
2. Restaurer le dernier dump avec `restore-check.sh` (`BACKUP_KEY` pour en choisir un autre).
3. Pointer `DATABASE_URL` de l'API et du worker vers la nouvelle base, redéployer.
4. Les webhooks reçus pendant la coupure sont rejoués par Converty ; lancer la réconciliation pour le reste.
