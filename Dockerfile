FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
EXPOSE 7070
CMD ["node", "--experimental-vm-modules", "server.js"]
