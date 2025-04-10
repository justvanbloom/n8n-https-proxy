FROM node:18-alpine
ENV http_proxy="http://proxy:1234/"
ENV https_proxy="http://proxy:1234/"
ENV no_proxy="localhost,127.0.0.1"
WORKDIR /app
RUN apk add --no-cache openssl
RUN openssl req -x509 -newkey rsa:4096 -keyout private.key -out certificate.crt -days 365 -nodes -subj "/CN=localhost"
COPY package.json ./
RUN npm install --omit=dev
COPY tunnel-proxy.js .
ENV http_proxy=""
ENV https_proxy=""
ENV no_proxy=""
EXPOSE 8443
CMD ["node", "tunnel-proxy.js"]
