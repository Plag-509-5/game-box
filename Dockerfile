# Image unique : construit l'interface puis lance le serveur Box (site + API + MongoDB).
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# MONGODB_URI et MONGODB_DB sont fournis par l'hébergeur (jamais dans l'image).
CMD ["node", "server.js"]
