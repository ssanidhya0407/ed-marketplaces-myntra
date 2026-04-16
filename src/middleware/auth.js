const AppError = require('../errors/AppError');
const crypto = require('crypto');

function authMiddleware(config) {
  function toEpochSeconds(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === 'string') {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber);
      const asDate = Date.parse(value);
      if (!Number.isNaN(asDate)) return Math.floor(asDate / 1000);
    }
    return null;
  }

  function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest();
  }

  function buildOpaqueTokenAllowlist() {
    const allowlist = [];
    if (config.webhookToken) {
      allowlist.push({
        hash: hashToken(config.webhookToken),
        expiresAtSec: toEpochSeconds(config.webhookTokenExpiry),
      });
    }

    if (config.tokenAllowlistJson) {
      try {
        const entries = JSON.parse(config.tokenAllowlistJson);
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (!entry || typeof entry.token !== 'string' || !entry.token) continue;
            allowlist.push({
              hash: hashToken(entry.token),
              expiresAtSec: toEpochSeconds(entry.expiresAt || entry.exp),
            });
          }
        }
      } catch (_error) {
        // ignore invalid JSON config to avoid taking down the service
      }
    }
    return allowlist;
  }

  const opaqueAllowlist = buildOpaqueTokenAllowlist();

  function verifyOpaqueToken(token) {
    if (!opaqueAllowlist.length) {
      return { valid: false, reason: 'No access_token configured on server' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const tokenHash = hashToken(token);

    let matched = false;
    for (const entry of opaqueAllowlist) {
      if (!crypto.timingSafeEqual(tokenHash, entry.hash)) continue;
      matched = true;
      if (entry.expiresAtSec && nowSec >= entry.expiresAtSec) {
        return { valid: false, reason: 'Token expired' };
      }
      return { valid: true, payload: { exp: entry.expiresAtSec || null, mode: 'opaque' } };
    }
    if (!matched) {
      return { valid: false, reason: 'Invalid access_token' };
    }
    return { valid: false, reason: 'Invalid access_token' };
  }

  function base64UrlToBuffer(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return Buffer.from(`${normalized}${padding}`, 'base64');
  }

  function verifySignedToken(token) {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'Malformed access_token' };
    }

    const [payloadPart, signaturePart] = parts;
    let payload;
    try {
      payload = JSON.parse(base64UrlToBuffer(payloadPart).toString('utf8'));
    } catch (_error) {
      return { valid: false, reason: 'Malformed access_token payload' };
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.tokenSigningSecret)
      .update(payloadPart)
      .digest('base64url');

    const actualSignature = signaturePart;
    const signatureValid =
      actualSignature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature));

    if (!signatureValid) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const clockSkew = Number.isFinite(config.tokenClockSkewSec) ? config.tokenClockSkewSec : 0;

    if (!payload.exp || Number(payload.exp) <= nowSec - clockSkew) {
      return { valid: false, reason: 'Token expired' };
    }
    if (payload.nbf && Number(payload.nbf) > nowSec + clockSkew) {
      return { valid: false, reason: 'Token not active yet' };
    }
    if (config.tokenIssuer && payload.iss !== config.tokenIssuer) {
      return { valid: false, reason: 'Invalid token issuer' };
    }

    return { valid: true, payload };
  }

  return (req, _res, next) => {
    const accessToken = req.headers.access_token;
    if (!accessToken || typeof accessToken !== 'string') {
      return next(new AppError(401));
    }

    const token = accessToken.trim();
    const verification = token.includes('.') ? verifySignedToken(token) : verifyOpaqueToken(token);
    if (!verification.valid) {
      return next(new AppError(403, verification.reason));
    }

    req.authToken = verification.payload;
    return next();
  };
}

module.exports = authMiddleware;
