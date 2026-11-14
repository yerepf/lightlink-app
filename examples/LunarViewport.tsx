import { useEffect, useRef } from 'react';
import { LunarEngine, type SiteData } from '../src/index';

/** Copy into a React + Vite project with react and @types/react installed. */
export function LunarViewport({ site, timestampMs, onError }: {
  site: SiteData; timestampMs: number; onError: (error: unknown) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<LunarEngine | null>(null);
  const latestTime = useRef(timestampMs);
  const reportError = useRef(onError);
  latestTime.current = timestampMs; reportError.current = onError;

  useEffect(() => {
    if (!container.current) return;
    try { engine.current = new LunarEngine(container.current); }
    catch (error) { reportError.current(error); return; }
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    let active = true;
    current.loadSite(site).then(() => {
      if (active) current.setTime(latestTime.current);
    }).catch(error => { if (active && error?.name !== 'AbortError') reportError.current(error); });
    return () => { active = false; };
  }, [site]);

  useEffect(() => {
    const current = engine.current;
    if (current?.getState()) {
      try { current.setTime(timestampMs); } catch (error) { reportError.current(error); }
    }
  }, [timestampMs]);
  return <div ref={container} style={{ width: '100%', height: '100%', minHeight: 400 }} aria-label="Vista 3D del sitio lunar" />;
}
