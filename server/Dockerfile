# Agentic OS server image. Used on the shared Hetzner box (see deploy/deploy-docker.sh),
# where the system Node is 20 and must not be replaced.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data NODE_ENV=production
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["sh", "-c", "node --experimental-sqlite --disable-warning=ExperimentalWarning src/migrate.js && exec node --experimental-sqlite --disable-warning=ExperimentalWarning src/index.js"]
