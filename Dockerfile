FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs content-store.mjs notes-store.mjs analytics.mjs analytics-store.mjs studio-analytics.mjs youtube-manager.mjs worker-policy.mjs ./
COPY public ./public
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
