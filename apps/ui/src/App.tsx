import { useEffect, useState, type ReactNode } from 'react';
import { getConfig, isUnauthorized, onUnauthorized } from './api';
import type { ConfigData, PanelId } from './types';
import { HealthPanel } from './panels/HealthPanel';
import { MemoryPanel } from './panels/MemoryPanel';
import { CpuPanel } from './panels/CpuPanel';
import { EventLoopPanel } from './panels/EventLoopPanel';
import { StartupPanel } from './panels/StartupPanel';
import { RequestsPanel } from './panels/RequestsPanel';
import { HeapSnapshotPanel } from './panels/HeapSnapshotPanel';
import { EnvPanel } from './panels/EnvPanel';
import { RoutesPanel } from './panels/RoutesPanel';
import { LogsPanel } from './panels/LogsPanel';
import { OutgoingPanel } from './panels/OutgoingPanel';
import { GenericPanel } from './panels/GenericPanel';

interface PanelSpec {
  id: PanelId;
  title: string;
  component: (intervalMs: number) => ReactNode;
}

const PANELS: PanelSpec[] = [
  { id: 'health', title: 'Health', component: (i) => <HealthPanel intervalMs={i} /> },
  { id: 'memory', title: 'Memory', component: (i) => <MemoryPanel intervalMs={i} /> },
  { id: 'cpu', title: 'CPU', component: (i) => <CpuPanel intervalMs={i} /> },
  {
    id: 'event-loop',
    title: 'Event Loop Lag',
    component: (i) => <EventLoopPanel intervalMs={i} />,
  },
  { id: 'startup', title: 'Startup Timeline', component: (i) => <StartupPanel intervalMs={i} /> },
  { id: 'requests', title: 'Requests', component: (i) => <RequestsPanel intervalMs={i} /> },
  {
    id: 'heap-snapshot',
    title: 'Heap Snapshot',
    component: () => <HeapSnapshotPanel />,
  },
  { id: 'env', title: 'Environment', component: (i) => <EnvPanel intervalMs={i} /> },
  { id: 'routes', title: 'Routes', component: (i) => <RoutesPanel intervalMs={i} /> },
  { id: 'outgoing', title: 'Outgoing Calls', component: (i) => <OutgoingPanel intervalMs={i} /> },
  { id: 'logs', title: 'Logs', component: (i) => <LogsPanel intervalMs={i} /> },
];

export default function App() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [denied, setDenied] = useState(isUnauthorized());

  useEffect(() => {
    if (isUnauthorized()) setDenied(true);
    return onUnauthorized(() => setDenied(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setConfigError(err instanceof Error ? err.message : 'Failed to load config');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (denied) {
    return (
      <main className="app">
        <section className="auth-screen" role="alert">
          <h1>nodeui</h1>
          <h2>Authentication required</h2>
          <p>
            This console is protected by an access token. Open it once with{' '}
            <code>?token=&lt;NODEUI_TOKEN&gt;</code> appended to the console URL; the server then
            stores an HttpOnly cookie and later visits work without the token.
          </p>
        </section>
      </main>
    );
  }

  if (configError) {
    return (
      <main className="app">
        <header className="app-header">
          <h1>nodeui</h1>
        </header>
        <p className="panel-error">{configError}</p>
      </main>
    );
  }

  const enabled = config?.enabled ?? true;
  const panels = config?.panels ?? PANELS.map((p) => p.id);
  const interval = config?.pollIntervalMs ?? 2000;
  const builtIn = PANELS.filter((p) => panels.includes(p.id));
  const plugins = (config?.plugins ?? []).filter((p) => !PANELS.some((b) => b.id === p.id));
  const navItems = [
    ...builtIn.map((p) => ({ id: p.id, title: p.title })),
    ...plugins.map((p) => ({ id: p.id, title: p.title || p.id })),
  ];

  return (
    <main className="app">
      <header className="app-header">
        <h1>nodeui</h1>
        {!enabled ? (
          <span className="status-pill status-critical">console disabled</span>
        ) : (
          <span className="status-pill status-ok">live</span>
        )}
        {config?.locked ? (
          <span className="lock-badge" title="Access token required" aria-label="token protected">
            🔒 token
          </span>
        ) : null}
      </header>
      <nav className="app-nav" aria-label="Panels">
        {navItems.map((item) => (
          <a key={item.id} href={`#panel-${item.id}`}>
            {item.title}
          </a>
        ))}
      </nav>
      <div className="grid">
        {builtIn.map((panel) => (
          <div key={panel.id} id={`panel-${panel.id}`} className="grid-item">
            {panel.component(interval)}
          </div>
        ))}
        {plugins.map((plugin) => (
          <div key={plugin.id} id={`panel-${plugin.id}`} className="grid-item">
            <GenericPanel id={plugin.id} title={plugin.title || plugin.id} intervalMs={interval} />
          </div>
        ))}
      </div>
    </main>
  );
}
