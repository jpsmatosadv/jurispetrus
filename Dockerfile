FROM node:22-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NODE_NO_WARNINGS=1 JURIS_DB_PATH=/data/acervo.db PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/http.js"]
