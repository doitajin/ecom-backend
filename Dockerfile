FROM node:24.15.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm ci --include=dev

COPY . .

WORKDIR /app/apps/backend
ENV NODE_ENV=production
ENV PORT=9000
ENV HOST=0.0.0.0
ARG MEDUSA_BACKEND_URL
ENV MEDUSA_BACKEND_URL=${MEDUSA_BACKEND_URL}

RUN npm run build

EXPOSE 9000
CMD ["sh", "-c", "if [ \"$MEDUSA_WORKER_MODE\" = \"worker\" ]; then npm run start; else npm run start:deploy; fi"]