# Box — déploiement sur Pterodactyl

Ce guide déploie Box sur un panneau [Pterodactyl](https://pterodactyl.io) (v1).
Le serveur n'a besoin que **d'un seul port** : l'interface, l'API et le
multijoueur (PeerJS auto-hébergé) sont servis ensemble.

> Prérequis : un nœud Pterodactyl avec Docker, une allocation libre,
> et un cluster [MongoDB Atlas](https://www.mongodb.com/atlas) (offre gratuite suffisante).

## 1. Importer l'egg (admin, une seule fois)

1. Panneau admin → **Nests** → choisir (ou créer) un nest « Node.js ».
2. **Import Egg** → téléverser [`pterodactyl/egg.json`](pterodactyl/egg.json).
3. L'egg apparaît comme **« Box Game »** (image `nodejs_22`, démarrage `npm start`).

Sans accès admin : crée simplement un serveur avec l'egg **Node.js** générique
et renseigne la *Startup Command* `npm start` (le reste du guide est identique).

## 2. Créer le serveur

| Réglage | Valeur |
|---|---|
| Egg | Box Game (ou Node.js générique) |
| Docker Image | `ghcr.io/pterodactyl/yolks:nodejs_22` |
| Startup Command | `npm start` |
| Allocations | **1 allocation** (ex. `123.45.67.89:8787`) — c'est tout |
| Disque / RAM | 1 Go disque, 512 Mo RAM (1024 Mo conseillés pour le build) |
| CPU | 50–100 % |

> Le serveur lit automatiquement le port injecté par Pterodactyl (`SERVER_PORT`)
> et écoute sur `0.0.0.0` : **aucune config réseau à faire dans le code**.
> À l'installation, l'egg exécute `npm install && npm run build`.

## 3. Configurer les variables (onglet Startup)

| Variable | Exemple | Obligatoire |
|---|---|---|
| `MONGODB_URI` | `mongodb+srv://box:xxxx@cluster.mongodb.net/?retryWrites=true&w=majority` | ✅ |
| `MONGODB_DB` | `box` | ✅ |
| `APP_URL` | `https://box.ton-domaine.fr` (ou `http://IP:PORT` sans domaine) | conseillé |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | voir § 5 | non |
| `GOOGLE_REDIRECT_URI` | `https://box.ton-domaine.fr/api/auth/google/callback` | si OAuth |
| `COOKIE_CROSS_SITE` | `false` | non |

## 4. Autoriser MongoDB Atlas

Atlas → **Network Access** → *Add IP Address* → renseigne **l'IP publique du nœud**
Pterodactyl (pas l'IP du panneau). En test uniquement : `0.0.0.0/0`.

Vérifie ensuite dans la console du serveur :

```
Box prête sur http://localhost:8787 (PeerJS : /peerjs)
MongoDB connecté (base « box »)
```

Et dans un navigateur : `http://IP:PORT/api/health` → `{"ok":true,"db":true,…}`.

**Ouvre le jeu sur `http://IP:PORT`** (ou ton domaine, § 6) : tout est servi ensemble.
Le multijoueur utilise `/peerjs` sur ce même port — aucun port supplémentaire.

## 5. Connexion Google (optionnel)

1. [Google Cloud Console](https://console.cloud.google.com) → *API et services* → *Identifiants* → **Créer un identifiant OAuth** (application Web).
2. **URI de redirection autorisée** (exacte, au caractère près) :
   `https://box.ton-domaine.fr/api/auth/google/callback`
3. Reporte l'ID client, le secret (et l'URI si différente de `APP_URL + /api/auth/google/callback`)
   dans les variables du serveur, puis **redémarre**.
4. Le bouton « Continuer avec Google » apparaît sur l'écran de connexion.

> Google exige une origine **HTTPS publique** (pas une IP:port HTTP) : passe par le § 6.

## 6. Domaine + HTTPS (recommandé)

Pterodactyl n'offre pas de HTTPS natif : place un reverse proxy devant l'allocation.

**Option A — Nginx (sur un VPS) :**

```nginx
server {
  listen 443 ssl;
  server_name box.ton-domaine.fr;
  ssl_certificate /etc/letsencrypt/live/box.ton-domaine.fr/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/box.ton-domaine.fr/privkey.pem;

  location / {
    proxy_pass http://IP_DU_NOEUD:PORT_ALLOUE;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade"; # requis pour le WebSocket /peerjs
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Puis `APP_URL=https://box.ton-domaine.fr` et redémarre.

**Option B — Cloudflare Tunnel** (`cloudflared`) : pas de port à ouvrir, HTTPS automatique.

## 7. Mettre à jour

1. Téléverse la nouvelle version (SFTP / Git) dans `/home/container`.
2. Console → `npm install && npm run build` (ou réinstalle le serveur).
3. Redémarre. À défaut de `dist/`, `npm start` reconstruit l'interface tout seul.

## 8. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `DB_NETWORK` sur l'écran de connexion | IP du nœud bloquée par Atlas | § 4 (Network Access) |
| `DB_AUTH_FAILED` | identifiants Atlas incorrects | corriger `MONGODB_URI`, redémarrer |
| `DB_NOT_CONFIGURED` | variable vide | renseigner `MONGODB_URI` (Startup) |
| Page blanche / 404 sur `/` | build manquant | `npm run build` puis redémarrer |
| Multijoueur « erreur réseau » | proxy sans WebSocket | `Upgrade`/`Connection` dans Nginx (§ 6) |
| `redirect_uri_mismatch` (Google) | URI inexacte | recopier l'URI **exacte** dans Google Cloud |
| Bouton Google absent | `GOOGLE_*` vides | renseigner les variables, redémarrer |
| `API_UNAVAILABLE` | mauvaise URL | ouvrir l'**allocation du serveur**, pas le panneau |

Diagnostic direct : `https://ton-domaine/api/health` doit renvoyer `"db":true` et `"oauth":{"google":true}`.
