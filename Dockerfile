FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY docs ./docs
COPY public ./public
COPY scripts ./scripts
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV HOST=0.0.0.0 MEMORY_DB=/app/data/memory.sqlite
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node","dist/server.js"]
