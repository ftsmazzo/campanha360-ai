FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
COPY . .
RUN npm run build -w @campanha360/worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
CMD ["node", "apps/worker/dist/main.js"]
