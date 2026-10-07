# Image unique : construit l'interface puis lance le serveur Box (site + API + MongoDB).
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

# MONGODB_URI, GOOGLE_*… sont fournis par l'hébergeur (jamais dans l'image).
# « npm start » reconstruit dist/ si besoin, puis lance site + API + PeerJS.
CMD ["npm", "start"]
