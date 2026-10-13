# syntax=docker/dockerfile:1.7

# Dependencies are isolated so source-code changes do not reinstall npm packages.
FROM node:22-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund --prefer-offline

# Build the web UI independently from backend/Prisma source.
# Changing only server/* or prisma/* will reuse this whole stage.
FROM deps AS web-builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY web ./web
RUN --mount=type=cache,target=/app/web/.next/cache \
    npm run build:web

# Generate Prisma independently from the web build.
FROM deps AS prisma-builder
WORKDIR /app
COPY prisma ./prisma
RUN npx prisma generate

# One shared runtime image for api, worker and web.
# server/* is copied last so backend-only edits are very cheap to rebuild.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/package*.json ./
COPY --from=prisma-builder /app/node_modules ./node_modules
COPY --from=prisma-builder /app/prisma ./prisma
COPY --from=web-builder /app/web ./web
COPY server ./server

EXPOSE 3000 4000
