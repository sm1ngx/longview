FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATABASE_URL=/data/longview.db
VOLUME /data
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
