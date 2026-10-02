# Persistence

By default everything lives in memory and disappears on restart. Pass `persist` to keep recent requests, outgoing calls, queries and errors across restarts (handy with `--watch` / nodemon):

```typescript
nodeui({ persist: '.nodeui/journal.ndjson' });
// or: { persist: { file: '.nodeui/journal.ndjson', maxBytes: 10_000_000 } }
```

The journal is append-only NDJSON written asynchronously in batches (never on the request path), created with mode `0600`, passed through secret masking before it is written, and rotated to `<file>.1` at `maxBytes` (default 5 MiB). It contains whatever the console records (paths, queries, headers, bodies if enabled), so **add it to `.gitignore`**. Logs are not persisted.

## Limitations

- **Single writer.** The journal is meant for one process. Several processes (cluster, pm2, replicas) appending to the same file can interleave lines, so give each process its own file (for example include `process.pid` in the name).
- **Crash window.** Writes are batched every ~250 ms and flushed on `server.shutdown()`. A hard crash or `kill -9` can lose the last fraction of a second; a torn last line is skipped on load.
- **Bounded history.** Only the current file and one rotated generation (`<file>.1`) are kept, so disk use stays under about twice `maxBytes`. Older activity is dropped, and what is restored is still capped by the in-memory ring-buffer sizes (`requestLogSize`, `outgoingLogSize`, `queryLogSize`).
- **Whole-file replay.** The journal is read fully into memory at startup. That is fine at the default 5 MiB; raising `maxBytes` far beyond tens of MiB slows startup.
- **No querying.** It is a replay log, not a database: you cannot search or aggregate past sessions from the UI, only see what was restored into the live panels.
- **Not everything is saved.** Logs, the per-second metrics chart, startup marks and heap snapshots are not persisted. Error counts reflect only the retained window.
- **Masked at write time.** Secrets are masked before they reach disk, but changing masking rules later does not rewrite old lines. Bodies and headers are only in the file if you enabled them.
- **Needs a writable path.** If the file or directory cannot be written, persistence silently does nothing so the host app is never affected.

## Why a file and not SQLite?

NodeUI supports Node 18+ and avoids native dependencies. `better-sqlite3` needs prebuilt binaries (problematic on some Alpine, Windows and CI images), and the built-in `node:sqlite` module requires Node 22.13+ and is still experimental. An append-only file covers the actual need (replay recent activity after a restart) with zero install cost. SQLite would help with multi-process sharing, querying older history and exact retention limits, so it is a candidate for an **optional backend** on Node versions that ship `node:sqlite`; it is not implemented yet.
