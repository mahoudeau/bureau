# Bureau hub. Zero npm dependencies, so no install step: copy and run.
# git is a runtime need, not a build one: the brain is a git repo.
FROM node:22-alpine

# The last label is how the official MCP registry ties this image to server.json.
LABEL org.opencontainers.image.source="https://github.com/mahoudeau/bureau" \
      org.opencontainers.image.description="Bureau hub: a self-hosted mission queue and git brain for AI agents" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      io.modelcontextprotocol.server.name="io.github.mahoudeau/bureau"

# git for the brain. The system config covers brains you bring yourself:
# a bind-mounted clone owned by another uid, or one with no committer set.
RUN apk add --no-cache git \
 && git config --system safe.directory '*' \
 && git config --system user.name Bureau \
 && git config --system user.email hub@bureau.local \
 && git config --system init.defaultBranch main \
 && mkdir -p /data /brain \
 && chown node:node /data /brain

WORKDIR /app
COPY --chown=node:node hub/ ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8100 \
    BUREAU_DATA_DIR=/data \
    BUREAU_BRAIN_DIR=/brain

USER node
VOLUME ["/data", "/brain"]
EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# node runs as PID 1 on purpose. The hub traps SIGTERM itself, and its data-dir
# lock is a pid file, so a stable pid means a restart always takes the lock back.
CMD ["node", "server.js"]
