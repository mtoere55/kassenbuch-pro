# Deployment — kassenbuch.handyreparatur.shop

Kassenbuch Pro darf im Live-Betrieb nicht unter `cidentia.live` veröffentlicht werden. Die korrekte Live-Domain ist:

```text
https://kassenbuch.handyreparatur.shop
```

## CidenDB / CID Redirect URI

Im CidenDB SDK App-Setup muss die Redirect URI so eingetragen werden:

```text
https://kassenbuch.handyreparatur.shop/cid/callback
```

Der Callback ist domain-neutral im Code angelegt und läuft unter:

```text
/cid/callback
```

Beispieltest nach dem Deployment:

```text
https://kassenbuch.handyreparatur.shop/cid/callback?cid=CID-TEST-001
```

## DNS

Für `kassenbuch.handyreparatur.shop` muss ein A-Record auf den VPS zeigen:

```text
kassenbuch  A  89.167.113.66
```

Optional, falls `www.kassenbuch.handyreparatur.shop` ebenfalls genutzt werden soll:

```text
www.kassenbuch  A  89.167.113.66
```

Falls Cloudflare verwendet wird, vor dem ersten Certbot-Test optional kurz DNS-only nutzen, bis SSL sauber erstellt ist.

## Nginx

```bash
cat >/etc/nginx/sites-available/kassenbuch-handyreparatur-shop <<'EOF'
server {
    listen 80;
    server_name kassenbuch.handyreparatur.shop;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

ln -sf /etc/nginx/sites-available/kassenbuch-handyreparatur-shop /etc/nginx/sites-enabled/kassenbuch-handyreparatur-shop
nginx -t
systemctl reload nginx
```

## SSL

```bash
certbot --nginx -d kassenbuch.handyreparatur.shop
```

## Systemd Service

Die App läuft intern auf Port `3010`:

```bash
cat >/etc/systemd/system/kassenbuch-pro.service <<'EOF'
[Unit]
Description=Kassenbuch Pro / kassenbuch.handyreparatur.shop
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kassenbuch-pro/app
Environment=NODE_ENV=production
Environment=PORT=3010
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kassenbuch-pro
systemctl restart kassenbuch-pro
systemctl status kassenbuch-pro --no-pager
```

## Deploy / Update

```bash
mkdir -p /opt/kassenbuch-pro
cd /opt/kassenbuch-pro

if [ ! -d app ]; then
  git clone https://github.com/mtoere55/kassenbuch-pro.git app
fi

cd app
git fetch origin
git switch main
git pull --ff-only origin main
npm install
npm run check
npm run build
systemctl restart kassenbuch-pro
```

## Live-Test

```text
https://kassenbuch.handyreparatur.shop
https://kassenbuch.handyreparatur.shop/cid/callback?cid=CID-TEST-001
```

Wenn der Callback die CID übernimmt und zurück zur Haupt-App führt, ist die CID-Rückgabe technisch korrekt angebunden.
