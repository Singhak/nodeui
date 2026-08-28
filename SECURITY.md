# Security Policy

NodeUI is a **local-only developer console**. Its default configuration
binds it to loopback and fails closed in production; this policy describes
how to report a security issue and what we consider in scope.

## Supported versions

Security fixes are backported to the latest minor release of the current
major version. Older majors are supported for six months after a successor
is released.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them
privately to the maintainers by opening a GitHub advisory at
https://github.com/nodeui/nodeui/security/advisories/new or by emailing
security@nodeui.dev.

You can expect:

1. An acknowledgment within 48 hours.
2. A status update at least every 5 business days.
3. A coordinated disclosure date once a fix is prepared.

## In-scope concerns

- Bypassing the loopback-only guard (requests from non-loopback hosts
  reaching the console when `host` is the default).
- Bypassing or weakening secret masking (`token|key|secret|password|credential`).
- Path traversal in the static asset server that escapes the embedded UI.
- Activation bypass — the console becoming active in production without
  `NODEUI_ENABLED=true`.
- Privilege escalation or arbitrary file access through the heap snapshot
  endpoint or confirmation flow.

## Out of scope / by design

- Using the console from another machine when the developer explicitly sets
  `host` to a non-loopback interface (a deliberate, warned action).
- The UI being reachable in development or test environments.
- Performance characteristics of masking and ring buffers.

## Secret handling

NodeUI redacts values under secret-matching keys, but it is **not** a
secret store. Do not rely on the mask as the only protection for production
credentials: keep `NODEUI_ENABLED` unset (or `false`) in production and never
mount the console on a public interface unless you have another access
control layer in front of it.
