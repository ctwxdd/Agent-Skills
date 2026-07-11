FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY monitor.mjs ./

CMD ["node", "monitor.mjs"]
