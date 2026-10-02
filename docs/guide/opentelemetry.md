# OpenTelemetry export

NodeUI can forward what it records to any OTLP/HTTP collector (Jaeger, Grafana Tempo, the OpenTelemetry Collector, ...) so it complements rather than replaces your tracing stack. No OpenTelemetry SDK is required.

```typescript
nodeui({ otlp: 'http://localhost:4318' });
// or: { otlp: { endpoint: 'https://collector.example/v1/traces', serviceName: 'api', headers: { authorization: '...' } } }
```

Each incoming request becomes a `SERVER` span; its outgoing HTTP calls and database queries are `CLIENT` child spans in the same trace. Statements and URLs are masked, query parameters are never included. Enabling export keeps the outgoing and query instrumentation running, and NodeUI warns if the endpoint is not local, because telemetry then leaves your machine.
