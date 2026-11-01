FROM node:24-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY apps/api apps/api
COPY apps/web apps/web
COPY deploy/hetzner deploy/hetzner
ENV NEXT_TELEMETRY_DISABLED=1
# Client generation and compilation do not connect to a database or use runtime secrets.
RUN AV8_ENV=dev AV8_OUTBOUND=disabled AV8_JOBS=disabled AV8_ROOT=/app ODIN_TOKEN_SECRET=build-only-not-a-runtime-secret-0000000000000000 DATABASE_URL=postgresql://av8_runtime:build@127.0.0.1:5548/av8_dev DATABASE_ADMIN_URL=postgresql://av8_owner:build@127.0.0.1:5548/av8_dev npm run build --workspace @odin/api
# Hosted build has no localhost API rewrite. Its server proxy reads the selected runtime configuration.
RUN AV8_HOSTING=hetzner AV8_ENV=staging AV8_OUTBOUND=disabled AV8_JOBS=disabled NODE_ENV=production ODIN_UI_BUILD_DIR=.next AV8_HETZNER_DEPLOYMENT_ID=av8-image-build AV8_HETZNER_RESOURCE=av8-erp-staging:av8-image-build ODIN_PUBLIC_ORIGIN=http://127.0.0.1:18180 ODIN_WEB_ORIGIN=http://127.0.0.1:18180 AV8_STAGING_PUBLIC_ORIGIN=http://127.0.0.1:18180 API_ORIGIN=http://api:8181 NEXT_PUBLIC_ODIN_DEMO_MODE=false ODIN_ALLOW_SHARED_DEMO_LOGINS=false ODIN_REQUIRE_PRIVILEGED_MFA=true npm run build --workspace @odin/web

FROM build AS maintenance
ARG AV8_SOURCE_REVISION=uncommitted
LABEL org.opencontainers.image.source="https://github.com/mohammaddashraff/odin-erp" org.opencontainers.image.revision=$AV8_SOURCE_REVISION
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node","deploy/hetzner/launch.mjs"]
CMD ["migrate"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS api
ARG AV8_SOURCE_REVISION=uncommitted
LABEL org.opencontainers.image.source="https://github.com/mohammaddashraff/odin-erp" org.opencontainers.image.revision=$AV8_SOURCE_REVISION
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=build /app/.av8/api .av8/api
COPY --from=build /app/apps/web/public apps/web/public
COPY deploy/hetzner deploy/hetzner
RUN mkdir -p /var/lib/av8-monitor && chown node:node /var/lib/av8-monitor
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node","deploy/hetzner/launch.mjs"]
CMD ["api"]

FROM node:24-bookworm-slim AS web
ARG AV8_SOURCE_REVISION=uncommitted
LABEL org.opencontainers.image.source="https://github.com/mohammaddashraff/odin-erp" org.opencontainers.image.revision=$AV8_SOURCE_REVISION
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
COPY deploy/hetzner/launch.mjs deploy/hetzner/launch.mjs
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8180 NEXT_TELEMETRY_DISABLED=1
USER node
ENTRYPOINT ["node","deploy/hetzner/launch.mjs"]
CMD ["web"]
