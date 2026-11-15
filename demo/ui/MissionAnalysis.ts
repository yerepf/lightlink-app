import { horizonElevation, type SiteData } from '../../src/data';
import { coverage, visibilitySummary } from '../../src/missionMetrics';
import type { LandingPoint } from '../../src/LunarEngine';
import { el, svgEl } from './dom';

export function angleChart(site: SiteData) {
  const frames = site.ephemeris_timeline;
  const { start, end } = coverage(frames);
  const tracks = [
    { label: 'Sun', color: '#e8a93c', dotted: false, values: frames.map(f => f.sun.elevation_deg) },
    { label: 'Horizon · Sun', color: '#e8a93c', dotted: true, values: frames.map(f => horizonElevation(site.horizon_mask, f.sun.azimuth_deg)) },
    { label: 'Earth', color: '#7fb0c4', dotted: false, values: frames.map(f => f.earth.elevation_deg) },
    { label: 'Horizon · Earth', color: '#7fb0c4', dotted: true, values: frames.map(f => horizonElevation(site.horizon_mask, f.earth.azimuth_deg)) },
  ];
  const values = tracks.flatMap(track => track.values);
  const low = Math.floor(Math.min(0, ...values) / 5) * 5;
  const high = Math.max(low + 5, Math.ceil(Math.max(0, ...values) / 5) * 5);
  const y = (angle: number) => 10 + (high - angle) / (high - low) * 86;
  const graph = svgEl('svg', { viewBox: '0 0 296 119', role: 'img', 'aria-label': 'Sun and Earth elevation against the local horizon, in degrees by UTC date' });
  for (const angle of new Set([high, 0, low])) {
    graph.append(svgEl('path', { d: `M28 ${y(angle)}H292`, stroke: '#85977b55' }));
    const label = svgEl('text', { x: 0, y: y(angle) + 3, fill: 'currentColor', 'font-size': 9 });
    label.textContent = `${angle}°`; graph.append(label);
  }
  for (const track of tracks) {
    const points = track.values.map((value, i) => `${(28 + (Date.parse(frames[i].timestamp_utc) - start) / Math.max(1, end - start) * 264).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
    graph.append(svgEl('polyline', { points, fill: 'none', stroke: track.color, 'stroke-width': track.dotted ? 1 : 1.5, 'stroke-dasharray': track.dotted ? '3 3' : '' }));
  }
  for (const [date, x, anchor] of [[start, 28, 'start'], [end, 292, 'end']] as const) {
    const label = svgEl('text', { x, y: 114, fill: 'currentColor', 'text-anchor': anchor, 'font-size': 9 });
    label.textContent = new Date(date).toISOString().slice(0, 10); graph.append(label);
  }
  return el('figure', { class: 'mission-chart' }, graph, el('figcaption', {}, ...tracks.map(track => {
    const sample = svgEl('svg', { viewBox: '0 0 16 4', width: 16, height: 4, 'aria-hidden': 'true' });
    sample.append(svgEl('path', { d: 'M0 2H16', stroke: track.color, 'stroke-width': 2, 'stroke-dasharray': track.dotted ? '3 3' : '' }));
    return el('span', {}, sample, track.label);
  })));
}

export function downloadAnalysis(format: 'csv' | 'json', site: SiteData, source: string, point?: LandingPoint) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const summary = visibilitySummary(site.ephemeris_timeline);
  const windows = summary.windows.map(({ condition, start, end, hours }) => ({ condition, start_utc: iso(start), end_utc: iso(end), duration_hours: hours }));
  const json = { site_id: site.site_id, source, landing_point_km: point ?? null, terrain_metadata: site.terrain_metadata,
    hours: summary.totals, windows, horizon_mask: site.horizon_mask, ephemeris_timeline: site.ephemeris_timeline };
  const csv = ['condition,start_utc,end_utc,duration_hours,source,landing_x_km,landing_z_km,slope_deg',
    ...windows.map(w => [w.condition, w.start_utc, w.end_utc, w.duration_hours, source, point?.x, point?.z, point?.slopeDeg].join(','))].join('\r\n') + '\r\n';
  const blob = new Blob([format === 'json' ? JSON.stringify(json, null, 2) : csv], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `${site.site_id}${point ? '-relocated' : ''}.${format}` });
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
