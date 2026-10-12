FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf /root/.npm/_cacache

COPY prisma ./prisma
RUN npx prisma generate

COPY server ./server
COPY web ./web

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build:web \
    && rm -rf web/.next/cache /root/.npm/_cacache

EXPOSE 3000 4000
