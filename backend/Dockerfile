FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install native build tools required for mediasoup C++ worker compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    python3-dev \
    git \
    pkg-config \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Runtime container
FROM node:22-bookworm-slim

WORKDIR /app

# Install runtime dependencies for mediasoup worker
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Local recordings folder
RUN mkdir -p /app/recordings

EXPOSE 3001
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

CMD ["node", "dist/main.js"]
