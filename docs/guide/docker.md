# Docker, proxies and hostnames

The console is loopback-only. If your app runs in a container, the browser's requests arrive from the Docker bridge, not from `127.0.0.1`. Allow that explicitly (and keep a token on):

```typescript
nodeui({
  allowedRemoteAddresses: ['172.16.0.0/12'], // Docker bridge networks (exact IPs, IPv4 and IPv6 CIDRs such as 'fd00::/8')
  allowedHosts: ['dev.myapp.test'], // extra Host header names, e.g. a local reverse proxy
  authToken: process.env.NODEUI_TOKEN, // open /nodeui/?token=... once; an HttpOnly cookie keeps you signed in
});
```

Publish the port on loopback only (`-p 127.0.0.1:3000:3000`). An `allowedRemoteAddresses` entry that is not a valid IP or CIDR is reported at startup and never matches. Requests carrying `X-Forwarded-*` headers are rejected unless `trustProxy: true`.
