FROM node:20-alpine
WORKDIR /app
COPY server_cloud.js package.json ./
EXPOSE 80
CMD ["node", "server_cloud.js"]
