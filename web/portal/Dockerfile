ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY web/portal/package.json web/portal/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
COPY web/portal web/portal
RUN npm run build -w @nursery/portal

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY package.json package-lock.json ./
COPY web/portal/package.json web/portal/package.json
COPY --from=build /app/web/portal/.next web/portal/.next
COPY --from=build /app/web/portal/public web/portal/public
COPY --from=build /app/web/portal/next.config.mjs web/portal/next.config.mjs
CMD ["npm", "run", "start", "-w", "@nursery/portal"]
