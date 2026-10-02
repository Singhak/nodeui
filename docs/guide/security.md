# Security and safety model

> [!IMPORTANT]
> NodeUI is engineered specifically for **local development environments**. A suite of built-in safeguards prevents accidental production exposure.

- **🚫 Fail-Closed in Production**: NodeUI turns completely off when `NODE_ENV=production` unless explicitly forced via `NODEUI_ENABLED=true`.
- **🏠 Loopback Binding Only**: Incoming requests from non-loopback addresses (`!127.0.0.1` and `!::1`) are immediately rejected with `403 Forbidden`.
- **🌐 DNS-Rebinding & CSRF Defence**: The `Host` and `Origin` headers must be loopback names (or allow-listed); proxied (`X-Forwarded-*`) requests are rejected by default. Responses carry CSP, `nosniff` and frame-deny headers.
- **🔑 Optional Access Token**: Set `authToken` / `NODEUI_TOKEN` to require a token (header, or a one-time `?token=` login that sets an HttpOnly cookie).
- **🛡️ Aggressive Secret Redaction**: Values under keys such as `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `COOKIE`, `DSN`, `DATABASE_URL`, plus credentials embedded in text (`postgres://user:pass@host`, bearer tokens, JWTs, `password=...` — including log lines) are replaced with `[REDACTED]`. Applies to REST and the live stream. Set `maskSecrets: false` to opt out.
- **📸 Private Heap Dumps**: Snapshots are written owner-only (`0600`) into a private directory. A heap dump contains every secret in memory; delete them when done.
- **🔑 Nonce-Gated Mutating Actions**: Heavy operations like V8 Heap Snapshots require a two-step challenge: request a single-use confirmation nonce via `POST /confirmations`, then submit with `x-nodeui-confirm` header.
- **⚡ Negligible Cost When Disabled**: When inactive, the middleware is a direct `next()` passthrough without event listeners or timers.
- **🧾 Credentials Never Stored**: `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key` and any header or query key that looks secret are redacted at capture time, even with `maskSecrets: false`. Request/response bodies are off by default.
