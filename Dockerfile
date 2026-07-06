FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

ENV CI=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV WORKER_PORT=8080

COPY package.json package-lock.json ./
COPY apps/scraper/package.json ./apps/scraper/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma ./packages/db/prisma
COPY packages/ai/package.json ./packages/ai/
COPY packages/lead-contact/package.json ./packages/lead-contact/
COPY packages/airbnb-parse/package.json ./packages/airbnb-parse/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/composio/package.json ./packages/composio/
RUN npm ci

COPY apps/scraper ./apps/scraper
COPY packages/db ./packages/db
COPY packages/ai ./packages/ai
COPY packages/lead-contact ./packages/lead-contact
COPY packages/airbnb-parse ./packages/airbnb-parse
COPY packages/crypto ./packages/crypto
COPY packages/composio ./packages/composio
COPY docs ./docs

RUN mkdir -p reports apps/scraper/playwright/.auth

COPY scripts/docker-worker-start.sh /app/scripts/docker-worker-start.sh
RUN chmod +x /app/scripts/docker-worker-start.sh

WORKDIR /app/apps/scraper
EXPOSE 8080
CMD ["/app/scripts/docker-worker-start.sh"]
