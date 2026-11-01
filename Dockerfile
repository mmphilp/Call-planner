# Builds the API, the admin console and the web version of the surgeon app
# into one image. See "Self-hosting" in README.md.

FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
RUN npm ci
COPY apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/
RUN cd apps/mobile && npm ci
COPY . .
RUN npm run build -w @call-planner/admin
RUN cd apps/mobile && EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir /src/web-app

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_PATH=/data/call-planner.db \
    ADMIN_DIR=/srv/admin \
    APP_DIR=/srv/app \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /srv/code
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev -w @call-planner/api && npm cache clean --force
COPY apps/api apps/api
COPY --from=build /src/apps/admin/dist /srv/admin
COPY --from=build /src/web-app /srv/app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
