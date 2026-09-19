FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/workflow-api/package.json ./services/workflow-api/
COPY services/workflow-api/tsconfig.json ./services/workflow-api/

RUN npm ci

COPY services/workflow-api/src/ ./services/workflow-api/src/

RUN npm run build --workspace=@workflow/shared-types
RUN npm run build --workspace=@workflow/shared-schemas
RUN npm run build --workspace=@workflow/telemetry
RUN npm run build --workspace=@workflow/workflow-api

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/ ./packages/
COPY services/workflow-api/package.json ./services/workflow-api/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
COPY --from=builder /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=builder /app/services/workflow-api/dist ./services/workflow-api/dist

EXPOSE 3000

CMD ["node", "services/workflow-api/dist/index.js"]
