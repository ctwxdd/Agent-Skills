FROM mcr.microsoft.com/playwright:v1.54.1-noble

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY monitor.mjs ./

CMD ["node", "monitor.mjs"]
