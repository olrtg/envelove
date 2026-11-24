FROM node:24-bookworm AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@12.14.0 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && CI=true pnpm prune --prod

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_URL=/data/envelove.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./scripts/migrate.mjs
RUN install -d -m 700 -o node -g node /data
USER node
EXPOSE 3000
CMD ["sh", "-ec", "node scripts/migrate.mjs && exec node .output/server/index.mjs"]
