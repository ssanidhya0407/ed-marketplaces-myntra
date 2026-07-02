# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- build (Next.js standalone) ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Session secret must be present at build time: the auth middleware runs in the
# Edge runtime, so process.env.OMS_SESSION_SECRET is inlined during `next build`.
# Must match the backend's OMS_SESSION_SECRET. Rebuild to rotate it.
ARG OMS_SESSION_SECRET
ENV OMS_SESSION_SECRET=$OMS_SESSION_SECRET
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3200
# OMS_BACKEND is supplied at `docker run` time (points at the backend container).

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3200
CMD ["node", "server.js"]
