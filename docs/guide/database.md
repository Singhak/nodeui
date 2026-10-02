# Database queries

`pg` and `mysql2` are instrumented automatically (resolved from your app's `node_modules`) while the **Queries** panel is open. Parameter values are never recorded.

```typescript
// Prisma: enable query events, then subscribe
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
server.trackPrisma(prisma);

// Sequelize / TypeORM / anything else
const sequelize = new Sequelize(url, {
  benchmark: true,
  logging: (sql, ms) => server.recordQuery({ system: 'sequelize', sql, durationMs: Number(ms) }),
});
```

Statements repeated 5 or more times within a single request are flagged as **N+1** suspects.
