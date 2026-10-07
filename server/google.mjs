// Connexion « Continuer avec Google » (OAuth 2.0 + OpenID Connect).
//
// Configuration (variables d'environnement) :
//   GOOGLE_CLIENT_ID      identifiant client OAuth (console Google Cloud)
//   GOOGLE_CLIENT_SECRET   secret client OAuth
//   GOOGLE_REDIRECT_URI    ex. https://box.ton-domaine.fr/api/auth/google/callback
//                          (ou APP_URL=http://localhost:8787 -> redirect dérivée automatiquement)
//
// Les trois variables doivent correspondre EXACTEMENT à la console Google Cloud
// (URI de redirection autorisée), sinon Google refuse avec « redirect_uri_mismatch ».
import { OAuth2Client } from 'google-auth-library';

const SCOPES = ['openid', 'email', 'profile'];

export function googleEnv(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  const appUrl = String(env.APP_URL || '').trim().replace(/\/+$/, '');
  const redirectUri =
    String(env.GOOGLE_REDIRECT_URI || '').trim() ||
    (appUrl ? `${appUrl}/api/auth/google/callback` : '');
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleConfigured(env = process.env) {
  const { clientId, clientSecret, redirectUri } = googleEnv(env);
  return Boolean(clientId && clientSecret && redirectUri);
}

function buildClient(env = process.env) {
  const { clientId, clientSecret, redirectUri } = googleEnv(env);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

/** URL de consentement Google (le paramètre `state` protège contre le CSRF). */
export function googleAuthUrl(state, env = process.env) {
  const client = buildClient(env);
  if (!client) throw new Error('OAUTH_NOT_CONFIGURED');
  return client.generateAuthUrl({ access_type: 'online', prompt: 'select_account', scope: SCOPES, state });
}

/** Échange le `code` retourné par Google contre des jetons, puis vérifie l'ID token. */
export async function googleProfileFromCode(code, env = process.env) {
  const client = buildClient(env);
  const { clientId } = googleEnv(env);
  if (!client || !clientId) throw new Error('OAUTH_NOT_CONFIGURED');
  const { tokens } = await client.getToken(String(code));
  if (!tokens?.id_token) throw new Error('OAUTH_FAILED');
  return googleProfileFromIdToken(tokens.id_token, env);
}

/** Vérifie un ID token Google (flux POST /api/auth/google) et renvoie le profil. */
export async function googleProfileFromIdToken(idToken, env = process.env) {
  const client = buildClient(env);
  const { clientId } = googleEnv(env);
  if (!client || !clientId) throw new Error('OAUTH_NOT_CONFIGURED');
  const ticket = await client.verifyIdToken({ idToken: String(idToken), audience: clientId });
  const payload = ticket.getPayload() || {};
  return {
    googleId: String(payload.sub || ''),
    email: String(payload.email || '').toLowerCase(),
    emailVerified: payload.email_verified !== false,
    name: String(payload.name || ''),
    picture: String(payload.picture || ''),
  };
}
