# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled files and required assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/api ./src/api

# Expose default ports
EXPOSE 3000 3001 3002 3003
CMD ["node", "dist/index.js"]