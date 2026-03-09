// --- Types --------------------------------------------------------------------

export type ServerStatus = 'checking' | 'online' | 'offline';

// --- Server Status Indicator -------------------------------------------------

export function ServerStatusBlock({ status, lastInjection }: { status: ServerStatus; lastInjection: string | null }) {
  const color =
    status === 'online'   ? '#7effd4' :
    status === 'offline'  ? '#ff6b6b' :
    'rgba(255,255,255,0.3)';

  const label =
    status === 'online'   ? 'PROCESSOR-SERVER ONLINE' :
    status === 'offline'  ? 'PROCESSOR-SERVER OFFLINE' :
    'CHECKING…';

  const injectionLabel = lastInjection
    ? `last injection: ${new Date(lastInjection).toLocaleString()}`
    : null;

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      gap: '3px',
      padding: '5px 11px',
      background: 'rgba(4, 5, 12, 0.85)',
      border: `1px solid ${color}33`,
      borderRadius: '4px',
      fontFamily: '"IBM Plex Mono", "Fira Code", "Courier New", monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: color,
          boxShadow: status !== 'checking' ? `0 0 8px ${color}` : 'none',
          animation: status === 'checking' ? 'pulse 1.5s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: '0.6rem',
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.45)',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
      </div>
      {injectionLabel && (
        <span style={{
          fontSize: '0.55rem',
          letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.25)',
          paddingLeft: '14px',
        }}>
          {injectionLabel}
        </span>
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}