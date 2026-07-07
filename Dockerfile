FROM node:20-alpine
WORKDIR /app
COPY server.js package.json ./
EXPOSE 3456
ENV RELAY_PORT=3456
ENV RELAY_API_KEY=""
CMD ["node", "server.js"]
