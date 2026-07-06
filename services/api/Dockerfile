ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY web/portal/package.json web/portal/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
COPY services/api services/api
RUN npm run build -w @nursery/api

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/services/api/dist services/api/dist
COPY services/api/package.json services/api/package.json
CMD ["node", "services/api/dist/main.js"]
