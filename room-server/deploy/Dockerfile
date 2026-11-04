FROM node:24-bookworm-slim
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY core.mjs d1-store.mjs schema.sql sqlite-store.mjs node-server.mjs ./room-server/
USER node
ENV NODE_ENV=production ROOM_HOST=127.0.0.1 PORT=8787 ROOM_DB_PATH=/data/classroom.sqlite
CMD ["node", "room-server/node-server.mjs"]
