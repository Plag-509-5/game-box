# Box — démarrage et déploiement

Box = une interface (React) **+ un serveur Node** qui parle à MongoDB. Le fichier `dist/index.html` seul est un site statique : il ne peut pas créer de compte. Il faut lancer le serveur.

## 1. En local (2 commandes)

```sh
npm run build
npm start
```

Ouvre **http://localhost:8787** : le site et l'API sont servis ensemble. Le serveur lit `.env` tout seul (Node ≥ 20.12).

Le serveur démarre toujours, même si MongoDB est injoignable, et se reconnecte automatiquement. L'écran de connexion affiche alors la cause exacte :

| Message | Cause | Solution |
|---|---|---|
| Service de comptes non démarré | `npm start` n'est pas lancé / pas hébergé | lancer le serveur |
| `DB_NETWORK` | Atlas bloque l'IP | Atlas → **Network Access** → autoriser l'IP du serveur |
| `DB_AUTH_FAILED` | identifiant ou mot de passe refusé | corriger `MONGODB_URI` |
| `DB_DNS` | adresse du cluster erronée | corriger `MONGODB_URI` |
| `DB_NOT_CONFIGURED` | `MONGODB_URI` absente | la définir dans `.env` |

Diagnostic direct : `http://localhost:8787/api/health` → `{"ok":true,"db":true}`.

## 2. En ligne (site accessible à tous)

Le serveur doit tourner sur un hébergeur Node (un hébergement purement statique ne suffit pas).

**Render (le plus simple)** — `render.yaml` est fourni :
1. Pousse le projet sur GitHub, puis Render → *New → Blueprint*.
2. Saisis le secret `MONGODB_URI`.
3. Dans Atlas → Network Access, autorise Render (`0.0.0.0/0` si l'IP est dynamique).

**Docker** — `Dockerfile` fourni : `docker build -t box . && docker run -p 8787:8787 -e MONGODB_URI=... box`

**Interface et API sur deux domaines ?** Sur l'écran de connexion, « Serveur hébergé ailleurs ? » permet de saisir l'adresse de l'API. Côté serveur, définis alors :
`APP_ORIGINS=https://ton-site.exemple.com` et `COOKIE_CROSS_SITE=true` (cookies `SameSite=None; Secure`, HTTPS obligatoire).

## 3. Ce qui est stocké dans MongoDB

| Collection | Contenu |
|---|---|
| `users` | email, pseudo, nom affiché, **mot de passe haché (bcrypt)**, préférences, statistiques |
| `sessions` | sessions révocables (hash du jeton), purge automatique à expiration |
| `friendships` | demandes d'amis et amitiés |
| `matches` | historique des parties |
| `avatars.*` | photos de profil (GridFS) |

## 4. Sécurité

- **Change le mot de passe de l'utilisateur Atlas** : l'URI a été partagée en clair dans une conversation, considère-la compromise. Mets ensuite à jour `.env` / le secret de l'hébergeur.
- `MONGODB_URI` ne va jamais dans une variable `VITE_*` (elle serait publique) ni dans git (`.env` est ignoré).
- Cookie `HttpOnly`, `Secure` + `SameSite=Strict` en production ; verrouillage 15 min après 8 échecs ; limitation de débit sur `/api/auth`.
- Les coups d'une partie en ligne restent en WebRTC (latence minimale) ; seul le résultat final est enregistré.
