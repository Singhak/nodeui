import { useEffect, useState, type ReactNode } from 'react';
import { getConfig } from './api';
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
  { id: 'logs', title: 'Logs', component: (i) => <LogsPanel intervalMs={i} /> },
];

export default function App() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

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
  const visible = PANELS.filter((p) => panels.includes(p.id));

  return (
    <main className="app">
      <header className="app-header">
        <h1>nodeui</h1>
        {!enabled ? (
          <span className="status-pill status-critical">console disabled</span>
        ) : (
          <span className="status-pill status-ok">live</span>
        )}
      </header>
      <div className="grid">
        {visible.map((panel) => (
          <div key={panel.id} className="grid-item">
            {panel.component(interval)}
          </div>
        ))}
      </div>
    </main>
  );
}
