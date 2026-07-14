FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PYTHON_CMD=python3

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/database

EXPOSE 3000

CMD ["npm", "start"]
