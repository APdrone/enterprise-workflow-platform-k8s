FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/notification-service/ ./services/notification-service/

RUN npm ci
RUN npm run build --workspace=@workflow/shared-types
RUN npm run build --workspace=@workflow/shared-schemas
RUN npm run build --workspace=@workflow/telemetry
RUN npm run build --workspace=@workflow/notification-service

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/ ./packages/
COPY services/notification-service/ ./services/notification-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
COPY --from=builder /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=builder /app/services/notification-service/dist ./services/notification-service/dist

EXPOSE 3001

CMD ["node", "services/notification-service/dist/index.js"]
