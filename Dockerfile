# syntax=docker/dockerfile:1

# --- Build stage: install all deps (incl. dev) and compile server + client ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
# --ignore-scripts skips the husky "prepare" hook (no .git in the build context).
# yarn installs devDependencies regardless of NODE_ENV, so the build gets tsc/vite.
RUN yarn install --frozen-lockfile --ignore-scripts
COPY . .
RUN yarn build

# --- Runtime stage: production deps only + compiled output ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean
# dist/client (built client + static assets) and dist/server are both copied.
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
