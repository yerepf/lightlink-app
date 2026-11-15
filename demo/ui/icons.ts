const icons: Record<string, string> = {
  surface:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 19.5 9 8l3.2 5.4L14.5 10l7 9.5H2.5Z"/><circle cx="17.5" cy="6" r="2.2"/></svg>',
  lander:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8c2.4 2 3.8 4.9 3.8 8.2V14h-7.6v-3c0-3.3 1.4-6.2 3.8-8.2Z"/><path d="M9.5 17h5M8 21l1.5-4M16 21l-1.5-4"/><circle cx="12" cy="9" r="1.5"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5M12 3.5C9.6 5.9 8.4 8.8 8.4 12s1.2 6.1 3.6 8.5"/></svg>',
  top:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/></svg>',
  cinematic:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M7 5.5v13M17 5.5v13M3 9.5h4M17 9.5h4M3 14.5h4M17 14.5h4"/></svg>',
  orbital:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-28 12 12)"/><circle cx="19" cy="8.2" r="1.3"/></svg>',
  site:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.2-5.4 6.2-10.2A6.2 6.2 0 0 0 5.8 10.8C5.8 15.6 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.2"/></svg>',
  view:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  layers:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/></svg>',
  energy:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="16" height="10" rx="2"/><path d="M21.5 10v4"/><path d="m11 9-2 3.2h3L10.5 15"/></svg>',
  coordinates:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
  info:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5.5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  play:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>',
  stepBack:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 5.5v13L9 12l9-6.5Z"/><rect x="5" y="5.5" width="2.4" height="13" rx="1"/></svg>',
  stepForward:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5.5v13l9-6.5-9-6.5Z"/><rect x="16.6" y="5.5" width="2.4" height="13" rx="1"/></svg>',
  loop:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3.5 20.5 7 17 10.5"/><path d="M20.5 7H7a3.5 3.5 0 0 0 0 7h1"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M3.5 17H17a3.5 3.5 0 0 0 0-7h-1"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  playCircle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m10 8.8 5 3.2-5 3.2V8.8Z"/></svg>',
  compass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>',
};

export function icon(name: keyof typeof icons | string): string {
  return icons[name] ?? '';
}
