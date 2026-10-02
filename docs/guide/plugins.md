# Custom panels (plugins)

Any object with an `id` and a `get()` becomes a panel. The UI renders arrays of objects as a table and objects as key/value rows.

```typescript
nodeui({
  plugins: [
    {
      id: 'queues', // lowercase letters, digits, "-"
      title: 'Job Queues',
      get: async () => ({ ok: true, data: await queue.getJobCounts() }),
    },
  ],
  // Show database / cache status in the Health panel:
  healthChecks: {
    postgres: () => pool.query('select 1'),
    redis: () => redis.ping(),
  },
});
```

Plugin output goes through the same secret masking as built-in panels. A `get()` that throws is reported as a `provider-failed` error instead of breaking the console.
