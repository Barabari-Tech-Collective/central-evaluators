# Playwright's own image ships the OS libraries Chromium needs (libnss3,
# libatk, etc.) that a plain Node buildpack doesn't have. Version pinned to
# match the resolved "playwright" package version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
