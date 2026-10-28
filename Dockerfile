FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build
RUN mkdir -p apps/web/.next/cache/images && chown -R node:node apps/web/.next/cache
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["./node_modules/.bin/concurrently", "-k", "npm run start:prod -w @odin/api", "npm exec -w @odin/web -- next start --hostname 0.0.0.0 --port 8080"]
