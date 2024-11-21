FROM node:22-slim

WORKDIR /usr/src/app

COPY package*.json .

RUN npm install

# Copy the rest of the application source code to the container
COPY ./*.js .
COPY ./readme.md .
COPY ./public/ ./public/

EXPOSE 3000

CMD [ "node", "server.js" ]