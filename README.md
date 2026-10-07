# Box — par Plag

**Box** est un jeu de carrés (*Dots & Boxes*) : ferme un carré, il prend ton
initiale et tu rejoues. Jouable **en local** (jusqu'à 4 joueurs / IA) et
**en ligne** (salles privées avec code d'invitation, temps réel).

Le projet = une interface React **+ un serveur Node** qui sert le site, l'API
(comptes, amis, historique) et le multijoueur (PeerJS auto-hébergé) **sur un
seul port**, avec MongoDB comme base de données.

## Fonctionnalités

- 🎮 Local : 2–4 joueurs, IA (3 difficultés), grilles 4×4 → 7×7, chrono, stats.
- 🌐 En ligne : salles à code, invitations d'amis, reconnexion auto, latence affichée.
- 👤 Comptes : inscription email, **connexion Google (OAuth)**, sessions révocables.
- 👥 Amis : recherche, demandes, invitations en salle depuis le dashboard.
- 🖼️ Profils : pseudo, avatar (upload), préférences (langue, son, animations).
- 📦 Déployable tel quel sur **Pterodactyl**, Docker et Render (un seul port).

## Démarrage rapide (local)

Prérequis : **Node.js ≥ 20.12** et un cluster [MongoDB Atlas](https://www.mongodb.com/atlas)
gratuit (ou un MongoDB local).

```sh
npm install
cp .env.example .env   # puis renseigne MONGODB_URI
npm run build
npm start              # → http://localhost:8787
```

`npm start` reconstruit `dist/` tout seul s'il manque. Le serveur lit `.env`
automatiquement et démarre **même si MongoDB est injoignable** (il se reconnecte
en tâche de fond ; l'écran de connexion affiche la cause exacte).

Développement (rechargement à chaud + API proxifiée) :

```sh
node server.js        # terminal 1 : API sur :8787
npm run dev           # terminal 2 : interface sur :5173 (proxy /api + /peerjs)
```

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | interface Vite (:5173, proxy vers l'API) |
| `node server.js` / `npm run dev:server` | API + PeerJS seuls (:8787) |
| `npm run build` | construit `dist/` |
| `npm start` | build si besoin + serveur complet (prod) |
| `npm run preview` | prévisualise `dist/` (:4173) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | suite de tests (`node --test tests/`) |

## Configuration

Toute la config passe par variables d'environnement (voir [`.env.example`](.env.example)) :

| Variable | Défaut | Rôle |
|---|---|---|
| `HOST` | `0.0.0.0` | adresse d'écoute |
| `PORT` / `SERVER_PORT` | `8787` | port d'écoute (`SERVER_PORT` = allocation Pterodactyl) |
| `NODE_ENV` | — | `production` active cookies `Secure`/`Strict` |
| `APP_URL` | — | URL publique (recommandé en prod, requis pour OAuth) |
| `FRONTEND_URL` | — | origine de l'interface si séparée de l'API |
| `APP_ORIGINS` | localhost… | origines CORS autorisées |
| `COOKIE_CROSS_SITE` | `false` | `true` uniquement si site et API sur 2 domaines (HTTPS requis) |
| `MONGODB_URI` | — | **requis** : URI MongoDB (jamais dans git, jamais en `VITE_*`) |
| `MONGODB_DB` | `box` | nom de la base |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | connexion Google (optionnel) |
| `GOOGLE_REDIRECT_URI` | `APP_URL/…/callback` | URI exacte déclarée dans Google Cloud |
| `API_PORT` | `PORT` | cible du proxy Vite en dev |
| `VITE_PEER_*` | `/peerjs` local | forcer un serveur PeerJS externe (dépannage) |

## Connexion Google (OAuth)

1. [Google Cloud Console](https://console.cloud.google.com) → *API et services* → *Identifiants* →
   **Créer un identifiant OAuth** (application Web).
2. **Origines JavaScript autorisées** : ton `APP_URL` (ex. `https://box.ton-domaine.fr`).
3. **URI de redirection autorisée** (exacte) : `https://box.ton-domaine.fr/api/auth/google/callback`.
4. `.env` : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (ou `GOOGLE_REDIRECT_URI`).
5. Redémarre : `api/health` affiche `"oauth":{"google":true}` et le bouton
   « Continuer avec Google » apparaît.

En local : `APP_URL=http://localhost:8787` + URI `http://localhost:8787/api/auth/google/callback`
(Google accepte `localhost` en HTTP pour le développement).

Un compte Google lie automatiquement un compte email de même adresse, et peut se
définir un mot de passe ensuite (dashboard → Sécurité).

## Déploiement

- 🦖 **[Pterodactyl](PTERODACTYL.md)** : egg importable fourni ([`pterodactyl/egg.json`](pterodactyl/egg.json)),
  un seul port, guide pas à pas (domaine, HTTPS, MongoDB Atlas).
- 🐳 **Docker** : `docker build -t box . && docker run -p 8787:8787 -e MONGODB_URI=… box`
- ☁️ **Render** : Blueprint via [`render.yaml`](render.yaml) (*New → Blueprint*),
  saisir les secrets `MONGODB_URI` (+ `APP_URL` / `GOOGLE_*`), autoriser Render dans Atlas.

Détails et matrice des messages d'erreur : voir [DEPLOYMENT.md](DEPLOYMENT.md).

## Architecture

```
├── src/                  interface React (Vite + Tailwind)
│   ├── auth/             session, appels API, OAuth
│   ├── game/             moteur Dots & Boxes (canvas), IA, audio, scores
│   ├── net/              multijoueur PeerJS (presence + salle, host = arbitre)
│   └── ui/               écrans (menu, en ligne, compte/dashboard)
├── server/
│   ├── index.mjs         Express : API, OAuth, PeerJS (/peerjs), sert dist/
│   └── google.mjs        helpers OAuth Google (testables sans DB)
├── scripts/start.mjs     démarrage robuste (build dist/ si absent)
├── tests/                suite de tests (node:test)
├── pterodactyl/egg.json  egg Pterodactyl importable
└── PTERODACTYL.md        guide de déploiement Pterodactyl
```

**Réseau.** Les coups transitent en WebRTC direct (hôte = arbitre, réconciliation
anti-triche) ; le serveur ne relaie que la signalisation PeerJS et n'enregistre
que le résultat final. Un seul port suffit : `/` (site), `/api/*` (comptes),
`/peerjs/*` (signalisation).

**Base.** Collections MongoDB : `users` (mot de passe **haché bcrypt**, `googleId`),
`sessions` (jetons hachés, purge auto), `friendships`, `matches`, `avatars.*` (GridFS).

## API (aperçu)

| Route | Méthode | Rôle |
|---|---|---|
| `/api/health` | GET | diagnostic (`ok`, `db`, `reason`, `oauth`, `peer`) |
| `/api/auth/providers` | GET | `{ google: bool }` (sans DB requise) |
| `/api/auth/google` | GET | démarre le consentement Google (302) |
| `/api/auth/google/callback` | GET | retour Google → session + redirection |
| `/api/auth/google` | POST | `{ idToken }` → session (variante API) |
| `/api/auth/register|login|logout|logout-all|password` | POST | comptes email |
| `/api/users/me` | GET/PATCH | profil courant |
| `/api/users/me/avatar` | POST | upload avatar (JPG/PNG/WebP, 3 Mo) |
| `/api/users/search?q=` | GET | recherche de joueurs |
| `/api/friends…` | GET/POST/DELETE | demandes et amitiés |
| `/api/matches` | GET/POST | historique des parties |

## Tests

```sh
npm run typecheck   # TypeScript strict
npm run build       # build Vite (fichier unique)
npm test            # API : health, providers, garde DB, OAuth, PeerJS, statique, CORS…
```

La suite démarre un vrai serveur sur le port 8799 **sans MongoDB** et vérifie les
comportements déconnectés (503 propres), la génération d'URL OAuth Google, le
serveur PeerJS (`/peerjs/peerjs/id`) et le routage. Les flux écriture (inscription,
callback OAuth complet) exigent MongoDB : checklist manuelle dans [DEPLOYMENT.md](DEPLOYMENT.md).

## Dépannage

| Message | Cause | Solution |
|---|---|---|
| Service de comptes non démarré | serveur éteint / mauvaise URL | `npm start`, ouvrir `http://localhost:8787` |
| `DB_NETWORK` | Atlas bloque l'IP | Atlas → Network Access → autoriser l'IP |
| `DB_AUTH_FAILED` | identifiants refusés | corriger `MONGODB_URI` |
| `DB_DNS` | cluster introuvable | corriger l'adresse dans `MONGODB_URI` |
| `DB_NOT_CONFIGURED` | `MONGODB_URI` absente | la définir dans `.env` |
| `redirect_uri_mismatch` | URI Google inexacte | recopier l'URI exacte (§ OAuth) |
| Multijoueur « erreur réseau » | WebSocket bloqué | proxy avec `Upgrade` (voir PTERODACTYL.md § 6) |

## Sécurité

- `.env` **jamais commité** (retiré du suivi git) ; `MONGODB_URI` jamais en `VITE_*`.
- Si l'URI Atlas a déjà été partagée en clair, **change le mot de passe** de l'utilisateur Atlas.
- Cookies `HttpOnly` (+ `Secure`/`Strict` en prod), verrouillage 15 min après 8 échecs,
  rate-limit sur `/api/auth`, `state` OAuth anti-CSRF, découverte PeerJS désactivée.
