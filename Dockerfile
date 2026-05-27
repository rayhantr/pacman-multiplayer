# syntax=docker/dockerfile:1

# --- Build stage: install all deps (incl. dev) and compile server + client ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the husky "prepare" hook (no .git in the build context).
RUN npm ci --include=dev --ignore-scripts
COPY . .
RUN npm run build

# --- Runtime stage: production deps only + compiled output ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# dist/client (built client + static assets) and dist/server are both copied.
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
