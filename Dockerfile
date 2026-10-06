FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Precies de versies uit package-lock.json, zodat elke build hetzelfde is.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV PORT=4000 NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
