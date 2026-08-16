FROM node:22-alpine

WORKDIR /app
COPY server ./server

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/index.mjs"]
