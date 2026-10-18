# FAQ and troubleshooting

<details>
<summary><b>I opened the console and there is a lot here. Where do I start?</b></summary>
<br/>
Start with <b>Overview</b> to see whether the app is healthy. Then use <b>Requests</b> or <b>Endpoints</b> to find what is slow, and <b>Errors</b> and <b>Queries</b> to find out why. Open <b>Runtime</b> and <b>Profiler</b> only when those point to CPU, memory or event-loop problems. The Diagnosis card suggests a next step.
</details>

<details>
<summary><b>The console is empty or shows no requests. What did I miss?</b></summary>
<br/>
Check the startup log first: NodeUI prints a warning when it is inactive by config (for example <code>NODE_ENV=production</code> or <code>NODEUI_ENABLED=false</code>). Then make sure the middleware or plugin is mounted <b>before</b> your routes (Express <code>app.use(middleware)</code>, Fastify <code>app.register(nodeui())</code>), and send a request to your app so there is something to record.
</details>

<details>
<summary><b>Do I need to install it in production, or keep it out of my build?</b></summary>
<br/>
No. Install it as a dev dependency. The console is off when <code>NODE_ENV=production</code>, and if you prune dev dependencies in production images, load it conditionally with a dynamic <code>import()</code> behind a <code>NODE_ENV</code> check (see the "How to Use It" steps).
</details>

<details>
<summary><b>Will it slow my app down?</b></summary>
<br/>
Disabled, the middleware is a plain <code>next()</code>. Enabled, expect a fraction of a millisecond per request, and sampling sleeps when the console is idle. Use <code>capture: 'lazy'</code> for zero cost until you open the console. See Benchmarks for measured numbers.
</details>

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

<details>
<summary><b>How is NodeUI different from Clinic.js?</b></summary>
<br/>
Clinic.js runs a one-off, offline analysis (Doctor, Flame, Bubbleprof, Heap Profiler). NodeUI is embedded and always on while you develop: live metrics history, per-request timelines, load-test baselines, a rule-based <b>Diagnosis</b> card (similar in spirit to Clinic Doctor), plus CPU and heap-allocation profiles on demand. It has no async-flow (Bubbleprof) view, so use Clinic for that kind of deep dive.
</details>
