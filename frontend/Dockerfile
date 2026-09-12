FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production Nginx server
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Custom nginx config to proxy API & WebSocket requests
RUN cat <<'EOF' > /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name localhost;

    # Allow large video and recording uploads up to 500MB without HTTP 413 Request Entity Too Large
    client_max_body_size 500M;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    # Proxy WebSocket signaling
    location /ws {
        proxy_pass http://backend:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Proxy REST API
    location /api/ {
        client_max_body_size 500M;
        proxy_pass http://backend:3001/api/;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Proxy recordings with full HTTP Range & video streaming support
    location /recordings/ {
        client_max_body_size 500M;
        proxy_pass http://backend:3001/recordings/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_buffering off;
        add_header Accept-Ranges bytes;
    }
}
EOF

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
