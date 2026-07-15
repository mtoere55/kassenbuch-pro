# Cidentia standard OTP login

Kassenbuch Pro uses Cidentia's existing external e-mail OTP endpoints. The application no longer needs manual CID entry, an SDK API key, an OAuth client ID or an OAuth client secret for this login path.

## Flow

1. The user enters an e-mail address in Kassenbuch Pro.
2. Kassenbuch Pro calls its own server route `POST /api/cidentia/otp/send`.
3. The server forwards the request to `POST https://api.cidendb.com/api/v1/auth/otp/send` with:

   ```json
   {
     "contact": "name@example.com",
     "contact_type": "email"
   }
   ```

4. The user enters the received code.
5. Kassenbuch Pro calls `POST /api/cidentia/otp/verify`.
6. The server forwards the request to `POST https://api.cidendb.com/api/v1/auth/otp/verify` with the `code` field.
7. A successful Cidentia response must contain a user object with a CID such as `cid_number`.
8. Kassenbuch Pro creates a signed, `HttpOnly`, `SameSite=Strict` session cookie. The raw OTP and any upstream response token are never stored in browser localStorage.

## Required production environment

Only the Kassenbuch session signing secret is required:

```env
CIDENTIA_SESSION_SECRET=GENERATE_A_RANDOM_VALUE_WITH_AT_LEAST_32_CHARACTERS
```

Generate it on the VPS:

```bash
openssl rand -hex 32
```

Optional endpoint and timeout overrides:

```env
CIDENTIA_OTP_BASE=https://api.cidendb.com/api/v1/auth/otp
CIDENTIA_OTP_TIMEOUT_MS=10000
```

The timeout accepts values from 1,000 to 30,000 milliseconds and defaults to 10 seconds.

## Abuse and availability protection

The Kassenbuch server applies an in-process fixed-window limit before contacting Cidentia:

- OTP send: 5 attempts per IP and e-mail combination per 15 minutes; 20 sends per IP.
- OTP verify: 10 attempts per IP and e-mail combination per 15 minutes; 50 verifies per IP.
- Rate-limited responses use HTTP `429` and include `Retry-After`.
- Cidentia network failures are mapped to controlled `502` or `504` responses.

This is the correct protection for the current single-process deployment. A future multi-instance deployment must move counters to a shared store such as Redis or the production database.

## VPS configuration

Store the secret outside Git:

```bash
nano /etc/kassenbuch-pro.env
chmod 600 /etc/kassenbuch-pro.env
systemctl daemon-reload
systemctl restart kassenbuch-pro
```

The systemd service must continue to load:

```ini
EnvironmentFile=/etc/kassenbuch-pro.env
```

## Browser routes

```text
POST   /api/cidentia/otp/send
POST   /api/cidentia/otp/verify
GET    /api/cidentia/session
DELETE /api/cidentia/session
GET    /api/health
```

The previous browser localStorage key `kassenbuch-pro.cid-session` is removed automatically by the new gateway. Authentication state is read only from the signed server cookie.
