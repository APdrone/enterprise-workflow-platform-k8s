FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/workflow-widget/ ./apps/workflow-widget/
COPY apps/host-app/ ./apps/host-app/

RUN npm ci
RUN npm run build --workspace=@workflow/shared-types
RUN npm run build --workspace=@workflow/telemetry
RUN npm run build --workspace=@workflow/workflow-widget
RUN npm run build --workspace=@workflow/host-app

FROM nginx:alpine

COPY apps/host-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/host-app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
