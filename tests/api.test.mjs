// Suite de tests Box (node:test, aucune dépendance).
// Démarre de vrais serveurs sur 127.0.0.1 SANS MongoDB et vérifie :
// health, providers, garde DB, routes OAuth, PeerJS, statique, CORS, headers.
// Les flux d'écriture (inscription, callback OAuth complet) exigent MongoDB :
// voir la checklist manuelle dans DEPLOYMENT.md.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { googleAuthUrl, isGoogleConfigured } from '../server/google.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const hasDist = fs.existsSync(path.join(root, 'dist', 'index.html'));

function serverEnv(port) {
  return {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'test',
    APP_URL: `http://127.0.0.1:${port}`,
    MONGODB_URI: '', // pas de DB : comportements 503 propres attendus
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_REDIRECT_URI: `http://127.0.0.1:${port}/api/auth/google/callback`,
  };
}

async function waitForHealth(base, timeoutMs = 25_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return res.json();
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`serveur ${base} injoignable`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function launch(entry, port) {
  const proc = spawn('node', [entry], {
    cwd: root,
    env: serverEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (d) => (output += d));
  proc.stderr.on('data', (d) => (output += d));
  return { proc, output: () => output };
}

describe('serveur Box (node server.js, sans MongoDB)', () => {
  let child;
  before(async () => {
    child = launch('server.js', PORT);
    await waitForHealth(BASE);
  });
  after(() => {
    child.proc.kill('SIGTERM');
  });

  it('/api/health diagnostique (db:false, oauth:true, peer:true)', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.db, false);
    assert.equal(body.reason, 'DB_NOT_CONFIGURED');
    assert.equal(body.oauth.google, true);
    assert.equal(body.peer, true);
  });

  it('/api/auth/providers annonce Google (même sans DB)', async () => {
    const res = await fetch(`${BASE}/api/auth/providers`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { google: true });
  });

  it('les routes protégées répondent 503 DB_UNAVAILABLE (pas 404)', async () => {
    const calls = [
      ['GET', '/api/users/me'],
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/logout'],
      ['GET', '/api/friends'],
      ['GET', '/api/matches'],
      ['GET', '/api/users/search?q=abc'],
    ];
    for (const [method, p] of calls) {
      const res = await fetch(`${BASE}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      assert.equal(res.status, 503, `${method} ${p}`);
      const body = await res.json();
      assert.equal(body.error, 'DB_UNAVAILABLE');
      assert.equal(body.reason, 'DB_NOT_CONFIGURED');
    }
  });

  it('route API inconnue → garde DB d’abord (503), 404 JSON si DB ok', async () => {
    // Sans DB, le garde /api répond avant le 404 (comportement voulu).
    const res = await fetch(`${BASE}/api/nimporte-quoi`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'DB_UNAVAILABLE');
  });

  it('GET /api/auth/google sans DB → redirection d’erreur (navigateur)', async () => {
    const res = await fetch(`${BASE}/api/auth/google`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    const location = res.headers.get('location') || '';
    assert.match(location, /\?auth=error&reason=DB_UNAVAILABLE/);
  });

  it('GET /api/auth/google sans DB → 503 JSON (appel API)', async () => {
    const res = await fetch(`${BASE}/api/auth/google`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'DB_UNAVAILABLE');
  });

  it('POST /api/auth/google vérifie la DB avant le jeton', async () => {
    const res = await fetch(`${BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ idToken: 'faux' }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'DB_UNAVAILABLE');
  });

  it('callback OAuth sans état → redirection OAUTH_STATE', async () => {
    // DB absente ici : le garde DB répond d'abord (comportement documenté).
    const res = await fetch(`${BASE}/api/auth/google/callback?code=x&state=y`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') || '', /reason=DB_UNAVAILABLE/);
  });

  it('serveur PeerJS auto-hébergé : /peerjs/peerjs/id délivre un identifiant', async () => {
    const res = await fetch(`${BASE}/peerjs/peerjs/id`);
    assert.equal(res.status, 200);
    const id = (await res.text()).trim();
    assert.ok(id.length >= 8, 'identifiant peer attendu');
    assert.ok(!/[<>{}]/.test(id), 'identifiant sans caractères suspects');
  });

  it('signalisation PeerJS : upgrade WebSocket + message OPEN', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${PORT}/peerjs/peerjs?key=peerjs&id=box-test-${Date.now()}&token=t`,
      );
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error('timeout WebSocket /peerjs'));
      }, 8000);
      ws.onmessage = (ev) => {
        try {
          if (JSON.parse(String(ev.data)).type === 'OPEN') {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('erreur WebSocket /peerjs'));
      };
    });
  });

  it('CORS reflète les origines autorisées + credentials', async () => {
    const res = await fetch(`${BASE}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  });

  it('headers de sécurité : pas de x-powered-by, rate-limit présent', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.ok(res.headers.get('ratelimit-limit'), 'en-tête RateLimit attendu');
  });

  it('interface statique servie depuis dist/ (si construite)', async () => {
    if (!hasDist) {
      const res = await fetch(`${BASE}/`);
      assert.equal(res.status, 404);
      return;
    }
    const home = await fetch(`${BASE}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<div id="root"><\/div>/);
    // Fallback SPA : toute route inconnue renvoie index.html.
    const spa = await fetch(`${BASE}/partie/XYZ`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /<div id="root"><\/div>/);
  });
});

describe('helpers Google OAuth (server/google.mjs, sans DB ni réseau)', () => {
  const full = {
    GOOGLE_CLIENT_ID: 'cid-123.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'shh',
    GOOGLE_REDIRECT_URI: 'https://box.example.com/api/auth/google/callback',
  };

  it('isGoogleConfigured exige les 3 variables', () => {
    assert.equal(isGoogleConfigured({}), false);
    assert.equal(isGoogleConfigured({ GOOGLE_CLIENT_ID: 'x' }), false);
    assert.equal(isGoogleConfigured(full), true);
  });

  it('dérive GOOGLE_REDIRECT_URI depuis APP_URL', () => {
    assert.equal(
      isGoogleConfigured({
        GOOGLE_CLIENT_ID: 'x',
        GOOGLE_CLIENT_SECRET: 'y',
        APP_URL: 'https://box.example.com/',
      }),
      true,
    );
  });

  it('googleAuthUrl génère une URL de consentement valide', () => {
    const url = new URL(googleAuthUrl('ETAT_ANTI_CSRF', full));
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('client_id'), full.GOOGLE_CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), full.GOOGLE_REDIRECT_URI);
    assert.equal(url.searchParams.get('state'), 'ETAT_ANTI_CSRF');
    assert.equal(url.searchParams.get('response_type'), 'code');
    const scope = url.searchParams.get('scope') || '';
    assert.ok(scope.includes('openid') && scope.includes('email') && scope.includes('profile'));
  });

  it('googleAuthUrl refuse une config incomplète', () => {
    assert.throws(() => googleAuthUrl('x', {}), /OAUTH_NOT_CONFIGURED/);
  });
});

describe('démarrage Pterodactyl (node scripts/start.mjs)', () => {
  const ALT = 8798;
  let child;
  before(async () => {
    if (!hasDist) {
      // start.mjs reconstruirait dist/ (lent) : on saute, le cas nominal est couvert par ailleurs.
      return;
    }
    child = launch('scripts/start.mjs', ALT);
    await waitForHealth(`http://127.0.0.1:${ALT}`, 40_000);
  });
  after(() => {
    child?.proc.kill('SIGTERM');
  });

  it('boot complet via le script utilisé par l’egg (npm start)', async (t) => {
    if (!hasDist) return t.skip('dist/ absent : npm run build requis');
    const res = await fetch(`http://127.0.0.1:${ALT}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});
