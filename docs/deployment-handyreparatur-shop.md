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

Direkter CID-Parameter ohne OAuth-Code reicht nicht mehr aus. Richtig ist:

```text
https://kassenbuch.handyreparatur.shop/cid/callback?code=...&state=...
```

## CidenDB Server-Umgebung

Der Browser darf keinen API Key oder Client Secret sehen. Deshalb müssen diese Werte im Systemd-Service auf dem Server gesetzt werden:

```bash
Environment=CIDENTIA_API_BASE=https://api.cidendb.com/api/v1/sdk
Environment=CIDENTIA_REDIRECT_URI=https://kassenbuch.handyreparatur.shop/cid/callback
Environment=CIDENTIA_API_KEY=PASTE_CIDENDB_API_KEY_HERE
Environment=CIDENTIA_CLIENT_ID=PASTE_CIDENDB_CLIENT_ID_HERE
Environment=CIDENTIA_CLIENT_SECRET=PASTE_CIDENDB_CLIENT_SECRET_HERE
```

Funktion:

- `CIDENTIA_API_KEY`: Quick Verify für manuell eingegebene CID über `/sdk/verify`.
- `CIDENTIA_CLIENT_ID` und `CIDENTIA_CLIENT_SECRET`: OAuth Flow über `/sdk/oauth/authorize` und `/sdk/oauth/token`.
- Ohne diese Werte öffnet die App nicht mehr direkt, sondern zeigt einen Konfigurationsfehler.

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

Auf diesem VPS sind `3010` und `3020` bereits von anderen `/var/www/c...` Prozessen belegt. Kassenbuch läuft deshalb intern auf `3099`:

```bash
cat >/etc/nginx/sites-available/kassenbuch-handyreparatur <<'EOF'
server {
    server_name kassenbuch.handyreparatur.shop;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3099;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/kassenbuch.handyreparatur.shop/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kassenbuch.handyreparatur.shop/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = kassenbuch.handyreparatur.shop) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name kassenbuch.handyreparatur.shop;
    return 404;
}
EOF

ln -sf /etc/nginx/sites-available/kassenbuch-handyreparatur /etc/nginx/sites-enabled/kassenbuch-handyreparatur
nginx -t
systemctl reload nginx
```

## SSL

```bash
certbot --nginx -d kassenbuch.handyreparatur.shop
```

## Systemd Service

Die App läuft intern auf Port `3099`:

```bash
cat >/etc/systemd/system/kassenbuch-pro.service <<'EOF'
[Unit]
Description=Kassenbuch Pro / kassenbuch.handyreparatur.shop
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kassenbuch-pro/app
Environment=NODE_ENV=production
Environment=CIDENTIA_API_BASE=https://api.cidendb.com/api/v1/sdk
Environment=CIDENTIA_REDIRECT_URI=https://kassenbuch.handyreparatur.shop/cid/callback
Environment=CIDENTIA_API_KEY=PASTE_CIDENDB_API_KEY_HERE
Environment=CIDENTIA_CLIENT_ID=PASTE_CIDENDB_CLIENT_ID_HERE
Environment=CIDENTIA_CLIENT_SECRET=PASTE_CIDENDB_CLIENT_SECRET_HERE
ExecStart=/opt/kassenbuch-pro/app/node_modules/.bin/next start -p 3099 -H 127.0.0.1
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

Der zweite Test muss jetzt absichtlich fehlschlagen, weil `cid=` alleine keine echte CidenDB-Prüfung ist.

Echte Tests:

```text
https://kassenbuch.handyreparatur.shop → Mit Cidentia anmelden
Manuelle CID → nur mit gültigem CIDENTIA_API_KEY und erfolgreichem /sdk/verify
```
