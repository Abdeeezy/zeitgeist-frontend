'use client';

import { useEffect, useState, useRef } from 'react';

import ParticleSimulation, { ParticleSimulationHandle } from './components/ParticleSimulation';
import ThemeStatBoard from './components/ThemeStatBoard';
import { defaultConfig } from './lib/simulation/simulationConfigs';
import { useSimulation } from './hooks/useSimulation';
import { ServerStatusBlock, ServerStatus } from './components/ServerStatusBlock';


// --- Config ------------------------------------------------------------------
// The processor-server URL. In production, set NEXT_PUBLIC_PROCESSOR_API_URL
// in your environment so the front-end calls the correct host.
const PROCESSOR_API = process.env.NEXT_PUBLIC_PROCESSOR_API_URL || 'http://127.0.0.1:8000';


// --- Page --------------------------------------------------------------------

export default function ZeitgeistPage() {

  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [lastInjection, setLastInjection] = useState<string | null>(null);

  const simulation = useSimulation(defaultConfig);
  const particleSimRef = useRef<ParticleSimulationHandle>(null);
  const hasAutoRestoredRef = useRef(false);


  // -- Server connection check ------------------------------------------------

  const checkServerConnection = async () => {
    try {
      const res = await fetch(`${PROCESSOR_API}/api/isOnline`);
      const data = await res.json();
      setServerStatus(data.status ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    }
  };

  // Run once on mount, then every 30 seconds.
  useEffect(() => {
    checkServerConnection();
    const interval = setInterval(checkServerConnection, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-populate simulation with backup data on page load.
  // Called by SimulationCanvas via onGpuReady — fires after init() + syncFromCPU()
  // complete, so the GPU engine is guaranteed to be ready to accept injections.
  // The ref guard ensures it only runs once even if the GPU effect re-runs.
  const handleAutoRestore = () => {
    if (hasAutoRestoredRef.current) return;
    hasAutoRestoredRef.current = true;

    fetch('/api/articles-backup')
      .then(r => r.json())
      .then(({ articles, lastUpdated }: { articles: { headline: string; themeScores: Record<string, number> }[]; lastUpdated: string | null }) => {
        articles.forEach(a => particleSimRef.current?.injectFromScores(a.themeScores, a.headline));
        if (lastUpdated) setLastInjection(lastUpdated);
        console.log(`Auto-restored ${articles.length} articles from backup`);
      })
      .catch(err => console.error('Auto-restore on load failed:', err));
  };


  // -- Inject from live server ------------------------------------------------

  const handleInject = async () => {
    try {
      const res = await fetch(`${PROCESSOR_API}/api/data`);
      const articles: { headline: string; keywords: string[]; themeScores: Record<string, number> }[] = await res.json();

      articles.forEach((article) => {
        particleSimRef.current?.injectFromScores(article.themeScores, article.headline);
      });

      // Persist to backup (headline + themeScores only — keywords not needed for restore)
      const backupRes = await fetch('/api/articles-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articles: articles.map(a => ({ headline: a.headline, themeScores: a.themeScores })),
        }),
      });
      const { lastUpdated } = await backupRes.json();
      if (lastUpdated) setLastInjection(lastUpdated);

      console.log(`Injected ${articles.length} articles into simulation`);
    } catch (err) {
      console.error('Error fetching articles:', err);
    }
  };



  return (
    <div className="flex min-h-screen items-center justify-center font-sans">
      <main className="flex min-h-screen w-full max-w-6xl flex-col items-center justify-between py-16 px-8 sm:px-16 bg-transparent sm:items-start">

        {/* Header */}
        <div className="flex flex-col items-center sm:items-start gap-4 mb-12">
          <h1 className="text-4xl font-bold text-[var(--foreground)] tracking-widest">
            Zeitgeist Engine
          </h1>
          <p className="text-sm text-[var(--foreground)] opacity-60 max-w-xl">
            A GPU-accelerated n-body particle simulation driven by thematic analysis of news articles.
            Each particle type represents a theme — their interactions are governed by a semantic attraction matrix
            derived from moral alignment, hierarchical proximity, and narrative overrides.
          </p>
        </div>

        {/* Content Section */}
        <div style={{ width: '100%' }} className="flex flex-col gap-4 mb-12">

          {/* Action row: status indicator + buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>

            <ServerStatusBlock status={serverStatus} lastInjection={lastInjection} />

            <button
              onClick={handleInject}
              disabled={serverStatus !== 'online'}
              className="mystic-button flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[var(--foreground)] font-medium transition-colors hover:bg-[var(--background)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject Articles
            </button>
          </div>

          {/* Particle Simulation */}
          <div style={{ width: '100%', height: '500px' }}>
            <ParticleSimulation
              ref={particleSimRef}
              engine={simulation.engine}
              isInitialized={simulation.isInitialized}
              fps={simulation.fps}
              setFps={simulation.setFps}
              randomizeRules={simulation.randomizeRules}
              reset={simulation.reset}
              togglePause={simulation.togglePause}
              onGpuReady={handleAutoRestore}
            />
          </div>

          <ThemeStatBoard engine={simulation.engine} colorScheme={defaultConfig.colorScheme} />
        </div>

      </main>
    </div>
  );
}
