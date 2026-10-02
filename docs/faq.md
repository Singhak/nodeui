# FAQ and troubleshooting

<details>
<summary><b>Why is the console only reachable from my local machine?</b></summary>
<br/>
By default, NodeUI binds strictly to <code>127.0.0.1</code> and rejects non-loopback requests with <code>403 Forbidden</code>. This is a crucial security barrier so sensitive runtime data and heap snapshots are never exposed to local networks or the public internet. If you need remote access for internal teams, place an authenticated reverse proxy in front of the application.
</details>

<details>
<summary><b>Why does the Routes panel show "No Express router captured yet"?</b></summary>
<br/>
NodeUI discovers Express routes lazily upon receiving the first request through the app router (Fastify, Hapi and Hono routes are collected from the framework as they are registered). Trigger any request against your backend API endpoints, then refresh the NodeUI dashboard. Koa and plain <code>node:http</code> have no router to introspect; call <code>server.setRoutes([...])</code> to list yours.
</details>

<details>
<summary><b>How do I forward custom logger messages (Winston, Pino) to NodeUI?</b></summary>
<br/>
NodeUI automatically captures native <code>console.log/info/warn/error</code>. For external loggers, use the provided helper method on the server instance:
<pre><code class="language-ts">server.addLogSource({ level: 'info', message: 'User logged in successfully' });
</code></pre>
</details>

<details>
<summary><b>Why are my environment variables showing as <code>[REDACTED]</code>?</b></summary>
<br/>
Keys containing terms like <code>KEY</code>, <code>SECRET</code>, <code>TOKEN</code>, <code>PASSWORD</code>, or <code>AUTH</code> are automatically masked for safety. You can disable masking by passing <code>maskSecrets: false</code> in your configuration options.
</details>

<details>
<summary><b>How does heap snapshot capture work with confirmation nonces?</b></summary>
<br/>
Capturing heap snapshots is a mutating action. When triggered from the UI, a confirmation modal automatically requests a single-use nonce from <code>POST /nodeui/api/confirmations</code> and passes it in the <code>x-nodeui-confirm</code> header to <code>POST /nodeui/api/heap-snapshot</code>.
</details>
