FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/audit-service/ ./services/audit-service/

RUN npm ci
RUN npm run build --workspace=@workflow/shared-types
RUN npm run build --workspace=@workflow/shared-schemas
RUN npm run build --workspace=@workflow/telemetry
RUN npm run build --workspace=@workflow/audit-service

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/ ./packages/
COPY services/audit-service/ ./services/audit-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
COPY --from=builder /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=builder /app/services/audit-service/dist ./services/audit-service/dist

EXPOSE 3002

CMD ["node", "services/audit-service/dist/index.js"]
