import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getConfig, isUnauthorized, onUnauthorized } from './api';
import { StatusPill } from './components/badges';
import { EmptyState, ErrorState, Skeleton } from './components/common';
import { hrefFor, useHashRoute } from './router';
import { TelemetryProvider, useTelemetry } from './telemetry';
import { useTheme } from './theme';
import type { ConfigData } from './types';
import { GenericView } from './views/GenericView';
import { ErrorsView } from './views/ErrorsView';
import { EnvView, LogsView, RoutesView } from './views/ListViews';
import { OutgoingView } from './views/OutgoingView';
import { Overview } from './views/Overview';
import { RequestsView } from './views/RequestsView';
import { RuntimeView } from './views/RuntimeView';

interface NavItem {
  id: string;
  title: string;
  icon: string;
  group: 'main' | 'custom';
  segments: string[];
}

const RUNTIME_PANELS = ['memory', 'cpu', 'event-loop', 'heap-snapshot', 'startup'];
const BUILT_IN_IDS = [
  'health',
  'memory',
  'cpu',
  'event-loop',
  'heap-snapshot',
  'startup',
  'requests',
  'env',
  'routes',
  'logs',
  'metrics',
  'outgoing',
  'errors',
];

export function buildNav(config: ConfigData | null): NavItem[] {
  const panels = config?.panels ?? BUILT_IN_IDS;
  const has = (id: string): boolean => panels.includes(id);
  const items: NavItem[] = [
    { id: 'overview', title: 'Overview', icon: '◩', group: 'main', segments: ['overview'] },
  ];
  if (has('requests'))
    items.push({
      id: 'requests',
      title: 'Requests',
      icon: '⇣',
      group: 'main',
      segments: ['requests'],
    });
  if (has('outgoing'))
    items.push({
      id: 'outgoing',
      title: 'Outgoing',
      icon: '⇡',
      group: 'main',
      segments: ['outgoing'],
    });
  if (has('errors'))
    items.push({
      id: 'errors',
      title: 'Errors',
      icon: '⚠',
      group: 'main',
      segments: ['errors'],
    });
  if (has('logs'))
    items.push({ id: 'logs', title: 'Logs', icon: '≣', group: 'main', segments: ['logs'] });
  if (has('env'))
    items.push({ id: 'env', title: 'Environment', icon: '⚙', group: 'main', segments: ['env'] });
  if (has('routes'))
    items.push({ id: 'routes', title: 'Routes', icon: '⑂', group: 'main', segments: ['routes'] });
  if (RUNTIME_PANELS.some(has))
    items.push({
      id: 'runtime',
      title: 'Runtime',
      icon: '◔',
      group: 'main',
      segments: ['runtime'],
    });
  for (const p of config?.plugins ?? []) {
    if (BUILT_IN_IDS.includes(p.id)) continue;
    items.push({
      id: `custom/${p.id}`,
      title: p.title || p.id,
      icon: '◇',
      group: 'custom',
      segments: ['custom', p.id],
    });
  }
  return items;
}

function AuthScreen() {
  return (
    <main className="auth-wrap">
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

function Sidebar({ items, activeId }: { items: NavItem[]; activeId: string }) {
  const main = items.filter((i) => i.group === 'main');
  const custom = items.filter((i) => i.group === 'custom');
  const link = (item: NavItem): ReactNode => (
    <li key={item.id}>
      <a
        href={hrefFor(...item.segments)}
        className="nav-link"
        aria-current={item.id === activeId ? 'page' : undefined}
      >
        <span className="nav-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span>{item.title}</span>
      </a>
    </li>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ◆
        </span>
        <h1>nodeui</h1>
      </div>
      <nav aria-label="Views" className="nav">
        <ul className="nav-list">{main.map(link)}</ul>
        {custom.length > 0 ? (
          <>
            <p className="nav-group" id="nav-custom">
              Custom
            </p>
            <ul className="nav-list nav-custom" aria-labelledby="nav-custom">
              {custom.map(link)}
            </ul>
          </>
        ) : null}
      </nav>
    </aside>
  );
}

const CONN_LABEL = { live: 'Live', paused: 'Paused', offline: 'Offline' } as const;
const CONN_ICON = { live: '●', paused: '❚❚', offline: '○' } as const;

function Topbar({ config }: { config: ConfigData }) {
  const t = useTelemetry();
  const { theme, toggle } = useTheme();
  return (
    <header className="topbar">
      <div className="topbar-left">
        {!config.enabled ? (
          <span className="status-pill status-critical">console disabled</span>
        ) : t.health ? (
          <span title={t.health.statusReason}>
            <StatusPill status={t.health.status} />
          </span>
        ) : null}
        {t.health ? <span className="topbar-reason">{t.health.statusReason}</span> : null}
        {config.locked ? (
          <span className="lock-badge" title="Access token required">
            <span aria-hidden="true">🔒</span> token protected
          </span>
        ) : null}
      </div>
      <div className="topbar-right">
        <span className={`conn conn-${t.connection}`} role="status">
          <span aria-hidden="true">{CONN_ICON[t.connection]}</span> {CONN_LABEL[t.connection]}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={t.paused}
          onClick={t.togglePause}
          title={t.paused ? 'Resume live updates' : 'Freeze the display'}
        >
          {t.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-icon"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
      </div>
    </header>
  );
}

function Shell({ config }: { config: ConfigData }) {
  const { segments } = useHashRoute();
  const items = buildNav(config);
  const interval = config.pollIntervalMs || 2000;
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  const view = segments[0] ?? 'overview';
  const activeId = view === 'custom' ? `custom/${segments[1] ?? ''}` : view;
  const known = items.some((i) => i.id === activeId);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [activeId]);

  const panels = config.panels;
  let body: ReactNode;
  if (!known) {
    body = (
      <EmptyState title="View not found">
        There is no view called “{activeId}”. <a href={hrefFor('overview')}>Back to Overview</a>
      </EmptyState>
    );
  } else if (view === 'overview') body = <Overview />;
  else if (view === 'requests') body = <RequestsView />;
  else if (view === 'outgoing') body = <OutgoingView intervalMs={interval} />;
  else if (view === 'errors') body = <ErrorsView intervalMs={interval} />;
  else if (view === 'logs') body = <LogsView intervalMs={interval} />;
  else if (view === 'env') body = <EnvView intervalMs={interval} />;
  else if (view === 'routes') body = <RoutesView intervalMs={interval} />;
  else if (view === 'runtime')
    body = (
      <RuntimeView
        intervalMs={interval}
        heapSnapshot={panels.includes('heap-snapshot')}
        startup={panels.includes('startup')}
      />
    );
  else {
    const plugin = config.plugins?.find((p) => p.id === segments[1]);
    body = (
      <GenericView
        key={segments[1]}
        id={segments[1] ?? ''}
        title={plugin?.title || segments[1] || ''}
        intervalMs={interval}
      />
    );
  }

  return (
    <div className="shell">
      <Sidebar items={items} activeId={activeId} />
      <div className="main-col">
        <Topbar config={config} />
        <main className="view" id="main" tabIndex={-1} ref={mainRef}>
          {body}
        </main>
      </div>
    </div>
  );
}

function LoadingShell({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          <h1>nodeui</h1>
        </div>
      </aside>
      <div className="main-col">
        <main className="view">
          {error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : (
            <Skeleton lines={6} label="Loading console" />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [denied, setDenied] = useState(isUnauthorized());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isUnauthorized()) setDenied(true);
    return onUnauthorized(() => setDenied(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setConfigError(null);
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
  }, [attempt]);

  if (denied) return <AuthScreen />;
  if (!config) return <LoadingShell error={configError} onRetry={() => setAttempt((n) => n + 1)} />;

  return (
    <TelemetryProvider intervalMs={config.pollIntervalMs || 2000}>
      <Shell config={config} />
    </TelemetryProvider>
  );
}
