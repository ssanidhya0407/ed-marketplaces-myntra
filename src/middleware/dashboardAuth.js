// Shared single-login session for the warehouse dashboard.
//
// A signed, httpOnly cookie (`oms_session`) gates both the Next.js UI (verified in
// the frontend middleware) and the dashboard data API here. The token is an
// HMAC-SHA256 of a small JSON payload, in the same base64url "<payload>.<sig>"
// shape the backend already uses for Myntra access tokens, so the frontend's
// Web Crypto verifier and this Node verifier agree byte-for-byte.
const crypto = require('crypto');
const env = require('./../config/env');

const COOKIE_NAME = 'oms_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

function signSession(email) {
  const payload = { sub: email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !env.sessionSecret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_error) {
    return null;
  }
  if (!payload.exp || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSession(req) {
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}

// `Secure` is required in prod (HTTPS) but blocks the cookie on a plain-HTTP LAN
// host in local dev (only exact `localhost` is exempt). OMS_COOKIE_INSECURE=1 drops
// it for local use; it stays on by default so production is unaffected.
const COOKIE_SECURE = process.env.OMS_COOKIE_INSECURE === '1' ? '' : ' Secure;';

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${COOKIE_SECURE} SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly;${COOKIE_SECURE} SameSite=Lax; Max-Age=0`);
}

// Password stored as "scrypt$<saltHex>$<hashHex>" (see scripts/hash-password.js).
// Plaintext passwords are never stored or compared.
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch (_error) {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// True once a login is configured on the server. When neither a session secret
// nor the legacy dashboard key is set, the dashboard stays open (back-compat).
function authConfigured() {
  return Boolean(env.sessionSecret && env.authEmail && env.authPasswordHash);
}

module.exports = {
  COOKIE_NAME,
  signSession,
  verifySession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  authConfigured,
};
