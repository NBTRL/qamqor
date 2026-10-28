FROM node:24-bookworm-slim AS build
RUN npm install --global pnpm@11.25.0
RUN apt-get update && apt-get install --no-install-recommends --yes openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV HUSKY=0 CI=1
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @club/shared build \
    && pnpm --filter @club/api build \
    && pnpm --filter @club/api deploy --prod --legacy --ignore-scripts /runtime

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ ./
USER node
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
