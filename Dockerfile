# Librea. The image is code; the school is the volume mounted at /data.
# Nothing is seeded at build time — docs/docker/entrypoint.sh seeds on first
# start only when the data directory has no ledger.
FROM node:20-bookworm-slim

# better-sqlite3 and onnxruntime-node are native; node-gyp needs a toolchain
# when a prebuilt binary is not available for this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source change does not rebuild native modules.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY editions ./editions
COPY data/seed ./data/seed
COPY docs/docker/entrypoint.sh /usr/local/bin/librea-entrypoint
RUN chmod +x /usr/local/bin/librea-entrypoint

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    LIBREA_DATA=/data \
    LIBREA_MODELS=/data/models

# The volume holds the ledger, the vectors, the SQLite projection, accounts,
# media, generated apps and the embedding model weights. It is created here so
# that an anonymous volume inherits the node user's ownership; a bind mount from
# the host keeps the host's ownership, so `chown -R 1000:1000 ./data` there if
# the container cannot write.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 4321

# HOST=0.0.0.0 is correct inside a container; put a TLS-terminating reverse
# proxy in front of the published port. See docs/security.md.
USER node
ENTRYPOINT ["librea-entrypoint"]
