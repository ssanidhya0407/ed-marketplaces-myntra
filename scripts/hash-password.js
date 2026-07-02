#!/usr/bin/env node
// Generate a scrypt hash for the dashboard login password.
//   node scripts/hash-password.js 'the-password'
// Prints a "scrypt$<salt>$<hash>" string to put in OMS_AUTH_PASSWORD_HASH.
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.js '<password>'");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 32);
process.stdout.write(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}\n`);
