FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/workflow-widget/ ./apps/workflow-widget/

RUN npm ci
RUN npm run build --workspace=@workflow/shared-types
RUN npm run build --workspace=@workflow/workflow-widget

FROM nginx:alpine

COPY --from=builder /app/apps/workflow-widget/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
