# The production image for AWS (App Runner). Vercel does not use this file.
#
# Only what the site needs at run time goes in: the server, the API, the pages, and the two
# files the API reads from disk (vercel.json for the routes, app-version.json for the APK
# updater). api/me.js and api/_lib/call-core.js also read public/*.html, so public/ is required.
FROM node:22-alpine

ENV NODE_ENV=production PORT=8080
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js vercel.json app-version.json ./
COPY api ./api
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "server.js"]
