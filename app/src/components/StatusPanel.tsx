import type { HealthResponse } from '@shared/contracts';

interface Props {
  health: HealthResponse | null;
  error: string | null;
}

/**
 * Reports what each seam actually resolved to at runtime. This is the page's
 * main job for now: making it obvious whether the deployment is talking to the
 * real Azure resources or running on in-process fallbacks.
 */
export function StatusPanel({ health, error }: Props) {
  if (error) {
    return (
      <section className="panel">
        <h2>Pipeline</h2>
        <p className="status status--bad">API unreachable</p>
        <p className="muted">{error}</p>
      </section>
    );
  }

  if (!health) {
    return (
      <section className="panel">
        <h2>Pipeline</h2>
        <p className="muted">Checking…</p>
      </section>
    );
  }

  const rows = [
    {
      label: 'API',
      ok: true,
      value: `${health.service} v${health.version}`,
      detail: `Responded at ${new Date(health.time).toLocaleTimeString()}`,
    },
    {
      label: 'Database',
      ok: health.data.backend === 'cosmos' && health.data.connected,
      value: health.data.backend === 'cosmos' ? `Cosmos DB · ${health.data.database}` : 'In-memory (fallback)',
      detail: health.data.detail,
    },
    {
      label: 'Storage',
      ok: health.storage.backend === 'azure_blob' && health.storage.connected,
      value:
        health.storage.backend === 'azure_blob'
          ? `Blob Storage · ${health.storage.account}`
          : 'In-memory (fallback)',
      detail: health.storage.detail,
    },
    {
      label: 'Auth',
      ok: health.auth.mode === 'swa',
      value: health.auth.mode === 'mock' ? 'Mock provider (placeholder)' : 'Static Web Apps identity',
      detail:
        health.auth.mode === 'mock'
          ? 'Seeded accounts only. Swap in a real provider before any real user data.'
          : 'Principal supplied by the platform.',
    },
  ];

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Pipeline</h2>
        <span className={`badge badge--${health.status === 'ok' ? 'ok' : 'warn'}`}>
          {health.status === 'ok' ? 'All services live' : 'Degraded'}
        </span>
      </div>

      <ul className="rows">
        {rows.map((row) => (
          <li key={row.label} className="row">
            <span className={`dot ${row.ok ? 'dot--ok' : 'dot--warn'}`} aria-hidden="true" />
            <div className="row__body">
              <div className="row__title">
                <span className="row__label">{row.label}</span>
                <span className="row__value">{row.value}</span>
              </div>
              <p className="muted">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
