const app = require('./app');
const env = require('./config/env');
const db = require('./db/mockDb');

const server = app.listen(env.port, () => {
  console.log(`Myntra OMS outbound backend listening on http://localhost:${env.port}`);
});

server.requestTimeout = env.requestTimeoutMs;
server.headersTimeout = Math.max(env.requestTimeoutMs + 500, 3000);
server.keepAliveTimeout = 5000;

async function gracefulShutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}, flushing persistent state...`);
  try {
    await db.flush();
  } catch (error) {
    console.error('[SHUTDOWN_FLUSH_ERROR]', error.message);
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
