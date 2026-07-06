#!/bin/sh
set -e

echo "[docker-start] applying prisma migrations..."
cd /app
npm run db:migrate:deploy

echo "[docker-start] starting worker..."
cd /app/apps/scraper
exec npm run worker:serve
