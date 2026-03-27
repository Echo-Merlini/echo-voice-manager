FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages edge_tts
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
EXPOSE 7070
CMD ["node", "--experimental-vm-modules", "server.js"]
