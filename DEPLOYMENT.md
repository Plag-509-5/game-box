# Box — déploiement

Le serveur unique sert le site `/`, l'API `/api/*` et le multijoueur `/peerjs/*`
**sur un seul port** (`PORT`, ou `SERVER_PORT` injecté par Pterodactyl, écoute `0.0.0.0`).

| Cible | Guide |
|---|---|
| 🦖 Pterodactyl (egg + HTTPS + Atlas) | [PTERODACTYL.md](PTERODACTYL.md) |
| 🐳 Docker | `docker build -t box . && docker run -p 8787:8787 -e MONGODB_URI=… box` |
| ☁️ Render | Blueprint [`render.yaml`](render.yaml) (*New → Blueprint*), secrets `MONGODB_URI` (+ `APP_URL`, `GOOGLE_*`) |

Dans tous les cas : autorise l'IP du serveur dans Atlas → **Network Access**,
puis vérifie `/api/health` → `{"ok":true,"db":true,…}`.

**Interface et API sur deux domaines ?** Sur l'écran de connexion, « Serveur hébergé
ailleurs ? » permet de saisir l'adresse de l'API. Côté serveur, définis alors :
`APP_ORIGINS=https://ton-site.exemple.com` (+ `FRONTEND_URL` pour le retour OAuth)
et `COOKIE_CROSS_SITE=true` (cookies `SameSite=None; Secure`, HTTPS obligatoire).

## Checklist manuelle (avec MongoDB)

Les tests automatisés (`npm test`) tournent **sans** MongoDB. Avant une mise en
production, vérifie avec une vraie base :

1. `npm run build && npm start` → `/api/health` : `"db":true`.
2. Inscription email → dashboard → avatar → déconnexion → reconnexion.
3. Recherche d'un 2ᵉ joueur → demande d'ami → acceptation → invitation en salle.
4. Salle à 2 onglets/appareils : coups temps réel, fin de partie, revanche.
5. Si OAuth : bouton Google visible → consentement → session créée → `?auth=google-ok` consommé.
6. Redémarre le serveur : la session persiste (MongoDB), le jeu local reste jouable hors-ligne.

## Ce qui est stocké dans MongoDB

| Collection | Contenu |
|---|---|
| `users` | email, pseudo, nom affiché, **mot de passe haché (bcrypt)**, `googleId`, photo Google, préférences, statistiques |
| `sessions` | sessions révocables (hash du jeton), purge automatique à expiration |
| `friendships` | demandes d'amis et amitiés |
| `matches` | historique des parties |
| `avatars.*` | photos de profil (GridFS) |

## Sécurité

- **Change le mot de passe de l'utilisateur Atlas** si l'URI a déjà été partagée en clair.
- `MONGODB_URI` ne va jamais dans une variable `VITE_*` (elle serait publique) ni dans git (`.env` est ignoré et retiré du suivi).
- Cookie `HttpOnly`, `Secure` + `SameSite=Strict` en production ; verrouillage 15 min après 8 échecs ; limitation de débit sur `/api/auth` ; `state` OAuth anti-CSRF.
- Les coups d'une partie en ligne restent en WebRTC (latence minimale) ; seul le résultat final est enregistré.
