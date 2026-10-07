import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import { ExpressPeerServer } from 'peer';
import {
  googleAuthUrl,
  googleProfileFromCode,
  googleProfileFromIdToken,
  isGoogleConfigured,
} from './google.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
// Charge .env automatiquement (Node >= 20.12) : plus besoin de --env-file.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* pas de .env : les variables viennent de l'hébergeur */
}
const prod = process.env.NODE_ENV === 'production';
const crossSite = process.env.COOKIE_CROSS_SITE === 'true';
// Pterodactyl injecte SERVER_PORT (allocation) ; HOST/SERVER_HOST pour l'écoute.
const host = process.env.HOST || process.env.SERVER_HOST || '0.0.0.0';
const port = Number(process.env.PORT || process.env.SERVER_PORT || 8787);
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'box';
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
const googleReady = isGoogleConfigured();

if (!mongoUri) console.error('MONGODB_URI manquant : définis-le dans le fichier .env du serveur.');
if (!googleReady)
  console.log('Google OAuth inactif : définis GOOGLE_CLIENT_ID/SECRET (+ APP_URL ou GOOGLE_REDIRECT_URI).');

const SESSION_DAYS = 30;
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

/* ------------------------------ MongoDB ------------------------------ */

let mongo = null;
let db, users, sessions, friendships, matches, avatars;
let dbReady = false;
let dbIssue = 'DB_CONNECTING';

// Traduit l'erreur du driver en code exploitable par l'interface (sans fuite de détails).
function classifyDbError(error) {
  const msg = String(error?.message || error).toLowerCase();
  if (msg.includes('authentication failed') || msg.includes('bad auth')) return 'DB_AUTH_FAILED';
  if (msg.includes('enotfound') || msg.includes('querysrv') || msg.includes('eai_again')) return 'DB_DNS';
  return 'DB_NETWORK'; // typiquement : IP non autorisée dans Atlas → "server selection timed out"
}

// Le serveur démarre TOUJOURS ; la connexion à MongoDB se rétablit en tâche de fond.
async function connectDb() {
  if (!mongoUri) {
    dbIssue = 'DB_NOT_CONFIGURED';
    return;
  }
  for (let attempt = 1; !dbReady; attempt++) {
    const client = new MongoClient(mongoUri, {
      maxPoolSize: 20,
      minPoolSize: 2,
      maxIdleTimeMS: 45_000,
      serverSelectionTimeoutMS: 8_000,
      retryReads: true,
      retryWrites: true,
    });
    try {
      await client.connect();
      mongo = client;
      db = client.db(dbName);
      users = db.collection('users');
      sessions = db.collection('sessions');
      friendships = db.collection('friendships');
      matches = db.collection('matches');
      avatars = new GridFSBucket(db, { bucketName: 'avatars', chunkSizeBytes: 128 * 1024 });
      await ensureIndexes();
      dbReady = true;
      dbIssue = '';
      console.log(`MongoDB connecté (base « ${dbName} »)`);
    } catch (error) {
      dbIssue = classifyDbError(error);
      console.error(`MongoDB indisponible (essai ${attempt}, ${dbIssue}):`, error?.message || error);
      await client.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1_500 * attempt)));
    }
  }
}

const ensureIndexes = () => Promise.all([
  users.createIndex({ emailLower: 1 }, { unique: true }),
  users.createIndex({ usernameLower: 1 }, { unique: true }),
  users.createIndex({ googleId: 1 }, { unique: true, sparse: true }),
  sessions.createIndex({ tokenHash: 1 }, { unique: true }),
  sessions.createIndex({ userId: 1 }),
  sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // purge automatique
  friendships.createIndex({ requesterId: 1, addresseeId: 1 }, { unique: true }),
  friendships.createIndex({ addresseeId: 1, status: 1 }),
  matches.createIndex({ ownerId: 1, createdAt: -1 }),
]);

/* ------------------------------ Express ------------------------------ */

function allowedOrigins() {
  const list = [process.env.APP_ORIGINS || '', APP_URL, FRONTEND_URL]
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length
    ? [...new Set(list)]
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:8787'];
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(
  cors({
    origin(origin, cb) {
      const allowed = allowedOrigins();
      const localDev = !prod && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
      cb(null, !origin || localDev || allowed.includes(origin));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '300kb' }));
app.use((req, _res, next) => {
  req.body ??= {}; // Express 5 ne l'initialise plus
  next();
});
app.use(cookieParser());

app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: true }));

// Diagnostic : toujours disponible, même si MongoDB est injoignable.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: dbReady,
    reason: dbReady ? '' : dbIssue,
    oauth: { google: googleReady },
    peer: true,
    time: new Date().toISOString(),
  });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_-]{3,14}$/;
const LANGUAGES = new Set(['fr', 'en', 'es', 'de', 'pt']);
const DEFAULT_PREFS = {
  language: 'fr',
  sound: true,
  reducedMotion: false,
  friendRequests: true,
  game: { size: 5, turnLimit: 10, difficulty: 'sharp', playerCount: 2 },
};

function cleanText(value, max = 60) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function avatarUrl(user) {
  if (user.avatarId) return `/api/users/${user._id}/avatar?v=${user.avatarVersion || 1}`;
  return user.avatarExternal || ''; // photo du compte Google, le cas échéant
}
function publicUser(user) {
  const p = user.preferences || {};
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: avatarUrl(user),
    authProvider: user.authProvider || 'email',
    hasPassword: !!user.passwordHash,
    preferences: {
      language: p.language || DEFAULT_PREFS.language,
      sound: p.sound ?? DEFAULT_PREFS.sound,
      reducedMotion: p.reducedMotion ?? DEFAULT_PREFS.reducedMotion,
      friendRequests: p.friendRequests ?? DEFAULT_PREFS.friendRequests,
      game: { ...DEFAULT_PREFS.game, ...(p.game || {}) },
    },
    stats: {
      games: user.stats?.games || 0,
      wins: user.stats?.wins || 0,
      boxes: user.stats?.boxes || 0,
    },
    createdAt: user.createdAt,
  };
}
function friendUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: avatarUrl(user),
    stats: publicUser(user).stats,
  };
}

/* ------------------------------ sessions (MongoDB) ------------------------------ */

const cookieOptions = {
  httpOnly: true,
  secure: prod || crossSite,
  // « none » uniquement si l'interface et l'API sont sur des domaines différents.
  sameSite: crossSite ? 'none' : prod ? 'strict' : 'lax',
  path: '/',
};

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await sessions.insertOne({
    tokenHash: sha256(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000),
    userAgent: cleanText(req.get('user-agent'), 160),
  });
  res.cookie('box_session', token, { ...cookieOptions, maxAge: SESSION_DAYS * 86_400_000 });
}

async function requireUser(req, res, next) {
  try {
    const token = req.cookies.box_session;
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const session = await sessions.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
    const user = session && (await users.findOne({ _id: session.userId }));
    if (!session || !user) {
      res.clearCookie('box_session', cookieOptions);
      return res.status(401).json({ error: 'INVALID_SESSION' });
    }
    // Rafraîchit la dernière activité au plus une fois par heure.
    if (Date.now() - session.lastSeenAt.getTime() > 3_600_000)
      sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    req.userId = user._id;
    req.user = user;
    req.sessionId = session._id;
    next();
  } catch (error) {
    next(error);
  }
}

/* ------------------------------ Google OAuth ------------------------------ */
// Ces routes sont AVANT le garde anti-DB : elles gèrent elles-mêmes l'absence
// de base (redirection vers l'interface avec un code d'erreur, pas une page JSON).

const OAUTH_STATE_COOKIE = 'box_oauth_state';
const oauthStateOptions = {
  httpOnly: true,
  secure: prod || crossSite,
  // Le retour de Google est une navigation cross-site : Strict bloquerait le cookie.
  sameSite: 'lax',
  path: '/api/auth/google',
  maxAge: 10 * 60 * 1000,
};

// Où renvoyer le navigateur après le consentement Google.
function frontendBase(req) {
  if (FRONTEND_URL) return FRONTEND_URL;
  if (APP_URL) return APP_URL;
  const origins = allowedOrigins();
  if (prod && origins.length && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(origins[0])) return origins[0];
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/api/auth/providers', (_req, res) => {
  res.json({ google: googleReady });
});

// Étape 1 : redirige vers le consentement Google.
app.get('/api/auth/google', (req, res) => {
  const base = frontendBase(req);
  if (!googleReady) {
    // Navigation directe : on renvoie vers l'interface avec un code d'erreur lisible.
    if (req.accepts('html')) return res.redirect(302, `${base}/?auth=error&reason=OAUTH_NOT_CONFIGURED`);
    return res.status(503).json({ error: 'OAUTH_NOT_CONFIGURED' });
  }
  if (!dbReady) {
    if (req.accepts('html')) return res.redirect(302, `${base}/?auth=error&reason=DB_UNAVAILABLE`);
    return res.status(503).json({ error: 'DB_UNAVAILABLE', reason: dbIssue });
  }
  const state = crypto.randomBytes(24).toString('base64url');
  res.cookie(OAUTH_STATE_COOKIE, state, oauthStateOptions);
  res.redirect(302, googleAuthUrl(state));
});

// Étape 2 : Google redirige ici avec ?code=…&state=…
app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const base = frontendBase(req);
  const fail = (reason) => res.redirect(302, `${base}/?auth=error&reason=${reason}`);
  if (!googleReady) return fail('OAUTH_NOT_CONFIGURED');
  if (!dbReady) return fail('DB_UNAVAILABLE');
  const { code, state } = req.query;
  const expected = req.cookies[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { ...oauthStateOptions, maxAge: undefined });
  if (!code || !state || !expected || state !== expected) return fail('OAUTH_STATE');
  let profile;
  try {
    profile = await googleProfileFromCode(String(code));
  } catch (error) {
    console.error('Google OAuth (callback) :', error?.message || error);
    return fail('OAUTH_FAILED');
  }
  if (!profile.googleId || !EMAIL.test(profile.email) || !profile.emailVerified) return fail('OAUTH_EMAIL');
  const user = await upsertGoogleUser(profile);
  await createSession(req, res, user._id);
  res.redirect(302, `${base}/?auth=google-ok`);
}));

// Variante API (jeton déjà obtenu côté client) : POST { idToken }.
app.post('/api/auth/google', asyncRoute(async (req, res) => {
  if (!googleReady) return res.status(503).json({ error: 'OAUTH_NOT_CONFIGURED' });
  if (!dbReady) return res.status(503).json({ error: 'DB_UNAVAILABLE', reason: dbIssue });
  const idToken = String(req.body.idToken || '');
  if (!idToken) return res.status(400).json({ error: 'OAUTH_FAILED' });
  let profile;
  try {
    profile = await googleProfileFromIdToken(idToken);
  } catch (error) {
    console.error('Google OAuth (id_token) :', error?.message || error);
    return res.status(401).json({ error: 'OAUTH_FAILED' });
  }
  if (!profile.googleId || !EMAIL.test(profile.email) || !profile.emailVerified)
    return res.status(401).json({ error: 'OAUTH_EMAIL' });
  const user = await upsertGoogleUser(profile);
  await createSession(req, res, user._id);
  res.json({ user: publicUser(user) });
}));

async function uniqueUsername(base) {
  const raw = String(base || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const stem = (raw.length >= 3 ? raw : `joueur${raw}`).slice(0, 10);
  for (let i = 0; i < 20; i++) {
    const candidate =
      i === 0 ? stem.slice(0, 14) : `${stem}_${crypto.randomInt(100, 9999)}`.slice(0, 14);
    if (!USERNAME.test(candidate)) continue;
    const exists = await users.findOne({ usernameLower: candidate.toLowerCase() });
    if (!exists) return candidate;
  }
  return `joueur_${crypto.randomBytes(3).toString('hex')}`;
}

async function upsertGoogleUser({ googleId, email, name, picture }) {
  const now = new Date();
  let user = await users.findOne({ googleId });
  if (user) {
    const set = { failedLogins: 0, lastLoginAt: now };
    if (!user.avatarId && picture && user.avatarExternal !== picture) set.avatarExternal = picture;
    await users.updateOne({ _id: user._id }, { $set: set, $unset: { lockUntil: '' } });
    return users.findOne({ _id: user._id });
  }
  user = await users.findOne({ emailLower: email });
  if (user) {
    // Lie le compte Google au compte email existant (l'email est vérifié par Google).
    const set = { googleId, failedLogins: 0, lastLoginAt: now, updatedAt: now };
    if (!user.avatarId && !user.avatarExternal && picture) set.avatarExternal = picture;
    await users.updateOne({ _id: user._id }, { $set: set, $unset: { lockUntil: '' } });
    return users.findOne({ _id: user._id });
  }
  const username = await uniqueUsername(name || email.split('@')[0]);
  const doc = {
    email,
    emailLower: email,
    username,
    usernameLower: username.toLowerCase(),
    displayName: cleanText(name, 40) || username,
    googleId,
    authProvider: 'google',
    passwordHash: null,
    avatarExternal: picture || '',
    preferences: DEFAULT_PREFS,
    stats: { games: 0, wins: 0, boxes: 0 },
    failedLogins: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  const result = await users.insertOne(doc);
  doc._id = result.insertedId;
  return doc;
}

// Tant que MongoDB n'est pas connecté, les autres routes répondent proprement.
app.use('/api', (_req, res, next) => {
  if (dbReady) return next();
  res.status(503).json({ error: 'DB_UNAVAILABLE', reason: dbIssue });
});

/* ------------------------------ auth (email) ------------------------------ */

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const username = cleanText(req.body.username, 14);
  const password = String(req.body.password || '');
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL' });
  if (!USERNAME.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'WEAK_PASSWORD' });

  const exists = await users.findOne({
    $or: [{ emailLower: email }, { usernameLower: username.toLowerCase() }],
  });
  if (exists)
    return res.status(409).json({ error: exists.emailLower === email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN' });

  const now = new Date();
  const doc = {
    email,
    emailLower: email,
    username,
    usernameLower: username.toLowerCase(),
    displayName: username,
    authProvider: 'email',
    passwordHash: await bcrypt.hash(password, 12),
    preferences: DEFAULT_PREFS,
    stats: { games: 0, wins: 0, boxes: 0 },
    failedLogins: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  const result = await users.insertOne(doc);
  doc._id = result.insertedId;
  await createSession(req, res, doc._id);
  res.status(201).json({ user: publicUser(doc) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  // Connexion avec l'email ou le pseudo.
  const identifier = cleanText(req.body.identifier ?? req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (!identifier || !password) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

  const user = await users.findOne({ $or: [{ emailLower: identifier }, { usernameLower: identifier }] });
  if (user?.lockUntil && user.lockUntil > new Date()) return res.status(429).json({ error: 'ACCOUNT_LOCKED' });
  if (user && !user.passwordHash && user.googleId)
    return res.status(401).json({ error: 'OAUTH_ACCOUNT' });

  const valid = !!user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    if (user) {
      const failed = (user.failedLogins || 0) + 1;
      const set = { failedLogins: failed };
      if (failed >= MAX_FAILED_LOGINS) {
        set.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        set.failedLogins = 0;
      }
      await users.updateOne({ _id: user._id }, { $set: set });
    }
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }

  await users.updateOne(
    { _id: user._id },
    { $set: { failedLogins: 0, lastLoginAt: new Date() }, $unset: { lockUntil: '' } },
  );
  await createSession(req, res, user._id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = req.cookies.box_session;
  if (token) await sessions.deleteOne({ tokenHash: sha256(token) });
  res.clearCookie('box_session', cookieOptions);
  res.status(204).end();
}));

app.post('/api/auth/logout-all', requireUser, asyncRoute(async (req, res) => {
  await sessions.deleteMany({ userId: req.userId });
  res.clearCookie('box_session', cookieOptions);
  res.status(204).end();
}));

app.post('/api/auth/password', requireUser, asyncRoute(async (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  if (next.length < 8 || next.length > 128) return res.status(400).json({ error: 'WEAK_PASSWORD' });
  if (req.user.passwordHash) {
    if (!(await bcrypt.compare(current, req.user.passwordHash)))
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  // Compte Google sans mot de passe : on autorise sa définition sans l'ancien.
  await users.updateOne(
    { _id: req.userId },
    { $set: { passwordHash: await bcrypt.hash(next, 12), updatedAt: new Date() } },
  );
  // Révoque les autres appareils, conserve la session courante.
  await sessions.deleteMany({ userId: req.userId, _id: { $ne: req.sessionId } });
  res.status(204).end();
}));

/* ------------------------------ profile ------------------------------ */

app.get('/api/users/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/users/me', requireUser, asyncRoute(async (req, res) => {
  const set = { updatedAt: new Date() };
  if (req.body.displayName !== undefined) {
    const displayName = cleanText(req.body.displayName, 40);
    if (displayName.length < 2) return res.status(400).json({ error: 'INVALID_DISPLAY_NAME' });
    set.displayName = displayName;
  }
  if (req.body.username !== undefined) {
    const username = cleanText(req.body.username, 14);
    if (!USERNAME.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME' });
    const collision = await users.findOne({
      usernameLower: username.toLowerCase(),
      _id: { $ne: req.userId },
    });
    if (collision) return res.status(409).json({ error: 'USERNAME_TAKEN' });
    set.username = username;
    set.usernameLower = username.toLowerCase();
  }
  if (req.body.preferences && typeof req.body.preferences === 'object') {
    const p = req.body.preferences;
    if (p.language !== undefined && LANGUAGES.has(p.language)) set['preferences.language'] = p.language;
    if (p.sound !== undefined) set['preferences.sound'] = !!p.sound;
    if (p.reducedMotion !== undefined) set['preferences.reducedMotion'] = !!p.reducedMotion;
    if (p.friendRequests !== undefined) set['preferences.friendRequests'] = !!p.friendRequests;
    if (p.game && typeof p.game === 'object') {
      const g = p.game;
      if ([4, 5, 6, 7].includes(Number(g.size))) set['preferences.game.size'] = Number(g.size);
      if ([0, 5, 10, 15, 20].includes(Number(g.turnLimit)))
        set['preferences.game.turnLimit'] = Number(g.turnLimit);
      if (['chill', 'sharp', 'ruthless'].includes(g.difficulty))
        set['preferences.game.difficulty'] = g.difficulty;
      if ([2, 3, 4].includes(Number(g.playerCount)))
        set['preferences.game.playerCount'] = Number(g.playerCount);
    }
  }
  await users.updateOne({ _id: req.userId }, { $set: set });
  res.json({ user: publicUser(await users.findOne({ _id: req.userId })) });
}));

app.post('/api/users/me/avatar', requireUser, upload.single('avatar'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'INVALID_IMAGE' });
  const oldId = req.user.avatarId;
  const stream = avatars.openUploadStream(`avatar-${req.userId}`, {
    metadata: { userId: req.userId, contentType: req.file.mimetype },
  });
  await new Promise((resolve, reject) => {
    Readable.from(req.file.buffer).pipe(stream).on('finish', resolve).on('error', reject);
  });
  await users.updateOne(
    { _id: req.userId },
    { $set: { avatarId: stream.id, avatarVersion: Date.now(), updatedAt: new Date() } },
  );
  if (oldId) avatars.delete(oldId).catch(() => {});
  res.json({ user: publicUser(await users.findOne({ _id: req.userId })) });
}));

app.get('/api/users/:id/avatar', asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.sendStatus(404);
  const user = await users.findOne({ _id: new ObjectId(req.params.id) }, { projection: { avatarId: 1 } });
  if (!user?.avatarId) return res.sendStatus(404);
  const file = await db.collection('avatars.files').findOne({ _id: user.avatarId });
  if (!file) return res.sendStatus(404);
  res.set({
    'Content-Type': file.metadata?.contentType || 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: String(file._id),
  });
  avatars.openDownloadStream(user.avatarId).on('error', () => res.end()).pipe(res);
}));

/* ------------------------------ friends ------------------------------ */

app.get('/api/users/search', requireUser, asyncRoute(async (req, res) => {
  const q = cleanText(req.query.q, 14).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = await users
    .find({ usernameLower: { $regex: `^${escaped}` }, _id: { $ne: req.userId } })
    .limit(8)
    .toArray();
  res.json({ users: found.map(friendUser) });
}));

async function friendshipPayload(userId) {
  const rows = await friendships
    .find({ $or: [{ requesterId: userId }, { addresseeId: userId }] })
    .sort({ updatedAt: -1 })
    .toArray();
  const ids = rows.map((r) => (r.requesterId.equals(userId) ? r.addresseeId : r.requesterId));
  const people = await users.find({ _id: { $in: ids } }).toArray();
  const map = new Map(people.map((p) => [String(p._id), p]));
  return rows
    .map((r) => {
      const outgoing = r.requesterId.equals(userId);
      const person = map.get(String(outgoing ? r.addresseeId : r.requesterId));
      if (!person) return null;
      return {
        id: String(r._id),
        status: r.status,
        direction: outgoing ? 'outgoing' : 'incoming',
        user: friendUser(person),
        updatedAt: r.updatedAt,
      };
    })
    .filter(Boolean);
}

app.get('/api/friends', requireUser, asyncRoute(async (req, res) => {
  res.json({ friendships: await friendshipPayload(req.userId) });
}));

app.post('/api/friends/requests/:userId', requireUser, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.userId)) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  const targetId = new ObjectId(req.params.userId);
  if (targetId.equals(req.userId)) return res.status(400).json({ error: 'CANNOT_ADD_SELF' });
  const target = await users.findOne({ _id: targetId });
  if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  if (target.preferences?.friendRequests === false)
    return res.status(403).json({ error: 'REQUESTS_DISABLED' });

  const relation = await friendships.findOne({
    $or: [
      { requesterId: req.userId, addresseeId: targetId },
      { requesterId: targetId, addresseeId: req.userId },
    ],
  });
  const now = new Date();
  if (relation?.status === 'accepted') {
    // rien à faire
  } else if (relation?.status === 'pending' && relation.addresseeId.equals(req.userId)) {
    await friendships.updateOne({ _id: relation._id }, { $set: { status: 'accepted', updatedAt: now } });
  } else if (!relation) {
    await friendships.insertOne({
      requesterId: req.userId,
      addresseeId: targetId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }
  res.status(201).json({ friendships: await friendshipPayload(req.userId) });
}));

app.post('/api/friends/requests/:requestId/accept', requireUser, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.requestId)) return res.sendStatus(404);
  const result = await friendships.updateOne(
    { _id: new ObjectId(req.params.requestId), addresseeId: req.userId, status: 'pending' },
    { $set: { status: 'accepted', updatedAt: new Date() } },
  );
  if (!result.matchedCount) return res.sendStatus(404);
  res.json({ friendships: await friendshipPayload(req.userId) });
}));

app.delete('/api/friends/:friendshipId', requireUser, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.friendshipId)) return res.sendStatus(404);
  await friendships.deleteOne({
    _id: new ObjectId(req.params.friendshipId),
    $or: [{ requesterId: req.userId }, { addresseeId: req.userId }],
  });
  res.json({ friendships: await friendshipPayload(req.userId) });
}));

/* ------------------------------ matches ------------------------------ */

app.post('/api/matches', requireUser, asyncRoute(async (req, res) => {
  const mode = req.body.mode === 'online' ? 'online' : 'local';
  const scores = Array.isArray(req.body.scores)
    ? req.body.scores.slice(0, 4).map((n) => Math.max(0, Math.min(100, Number(n) || 0)))
    : [];
  const names = Array.isArray(req.body.names)
    ? req.body.names.slice(0, 4).map((n) => cleanText(n, 14))
    : [];
  if (scores.length < 2 || scores.length !== names.length)
    return res.status(400).json({ error: 'INVALID_MATCH' });
  const myIndex = Math.max(0, Math.min(scores.length - 1, Number(req.body.myIndex) || 0));
  const max = Math.max(...scores);
  const won = scores[myIndex] === max && scores.filter((s) => s === max).length === 1;
  await matches.insertOne({
    ownerId: req.userId,
    mode,
    size: Math.max(4, Math.min(7, Number(req.body.size) || 5)),
    names,
    scores,
    myIndex,
    won,
    createdAt: new Date(),
  });
  await users.updateOne(
    { _id: req.userId },
    { $inc: { 'stats.games': 1, 'stats.wins': won ? 1 : 0, 'stats.boxes': scores[myIndex] } },
  );
  res.status(201).json({ user: publicUser(await users.findOne({ _id: req.userId })) });
}));

app.get('/api/matches', requireUser, asyncRoute(async (req, res) => {
  const recent = await matches.find({ ownerId: req.userId }).sort({ createdAt: -1 }).limit(10).toArray();
  res.json({ matches: recent.map(({ ownerId: _o, ...m }) => ({ ...m, _id: String(m._id) })) });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API_NOT_FOUND' }));

/* ------------------------------ démarrage ------------------------------ */

const server = app.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Box prête sur http://${shown}:${port} (PeerJS : /peerjs)`);
  if (googleReady) console.log('Google OAuth actif.');
  void connectDb();
});

// Serveur PeerJS auto-hébergé sur le MÊME port : le multijoueur ne dépend plus
// du cloud public PeerJS (source des pannes « serveur en ligne »). Le client
// se connecte sur /peerjs (voir VITE_PEER_* pour forcer un autre serveur).
const peerServer = ExpressPeerServer(server, { path: '/', proxied: true, allow_discovery: false });
app.use('/peerjs', peerServer);

// Sert l'interface construite (npm run build) : une seule adresse pour le site ET l'API.
const dist = path.join(root, 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { maxAge: prod ? '1y' : 0, index: false }));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html'))); // SPA : toujours index.html
} else {
  console.log('dist/ absent : API seule. Lance « npm run build » pour servir aussi l’interface.');
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === 11000) return res.status(409).json({ error: 'DUPLICATE_VALUE' });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'IMAGE_TOO_LARGE' });
  res.status(500).json({ error: 'SERVER_ERROR' });
});

async function shutdown() {
  server.close();
  await mongo?.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
