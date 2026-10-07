// Stroke icons on a 24px grid. icon('home') -> <svg>
const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5h3v5h5V9.5',
  today: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  calendar: 'M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4M8 14h2M14 14h2M8 17h2',
  inbox: 'M3.5 13 6 5h12l2.5 8M3.5 13v6h17v-6M3.5 13h5l1 2.5h5l1-2.5h5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21M12 3C9.4 5.6 8.2 8.6 8.2 12s1.2 6.4 3.8 9',
  spark: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
  briefcase: 'M3.5 8h17v11h-17zM9 8V5.5h6V8M3.5 13h17',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z',
  journal: 'M6 3.5h11.5V20.5H6a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 6 3.5ZM8.5 8h6M8.5 11.5h6M4.5 17h13',
  agent: 'M12 3v3M7 6h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3ZM9 11v1.5M15 11v1.5M9.5 15.5h5M2 11v3M22 11v3',
  // Cog after Lucide (ISC): rounded teeth read as a gear at 20px, unlike a polygon outline.
  settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  capture: 'M4 4.5h16v15H4zM8 9h8M8 12.5h8M8 16h4.5',
  archive: 'M3.5 5h17v4h-17zM5 9v10h14V9M10 12.5h4',
  heart: 'M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10ZM3 12.5h4l1.5-2.5 2.5 5 1.5-2.5H21',
  rank: 'M6 14l6-5 6 5M6 19l6-5 6 5M6 9l6-5 6 5',
  plan: 'M4 5h16M4 12h16M4 19h10',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20',
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  reset: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3',
  sync: 'M20 11a8 8 0 0 0-14.3-4.6M4 5v4h4M4 13a8 8 0 0 0 14.3 4.6M20 19v-4h-4',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  min: 'M5 12h14',
  max: 'M6 6h12v12H6z',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z',
  slack: 'M9.5 3.5a1.8 1.8 0 0 0 0 3.6h1.8V5.3a1.8 1.8 0 0 0-1.8-1.8ZM3.5 9.5a1.8 1.8 0 0 0 1.8 1.8h4.2V9.5a1.8 1.8 0 0 0-1.8-1.8H5.3a1.8 1.8 0 0 0-1.8 1.8ZM20.5 14.5a1.8 1.8 0 0 0-1.8-1.8h-4.2v1.8a1.8 1.8 0 0 0 1.8 1.8h2.4a1.8 1.8 0 0 0 1.8-1.8ZM14.5 20.5a1.8 1.8 0 0 0 0-3.6h-1.8v1.8a1.8 1.8 0 0 0 1.8 1.8ZM12.7 3.5v6M11.3 14.5v6M3.5 12.7h6M14.5 11.3h6',
  mail: 'M3.5 6h17v12h-17zM3.5 6.5l8.5 6.5 8.5-6.5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z',
  down: 'M6.5 9.5 12 15l5.5-5.5',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  expand: 'M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5 13.5 10.5M4.5 19.5l6-6',
  collapse: 'M19.5 4.5l-5.5 5.5M14 5.5V10h4.5M4.5 19.5l5.5-5.5M10 18.5V14H5.5',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2',
  pin: 'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11ZM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  grip: 'M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01'
};

export function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', P[name] || P.more);
  svg.appendChild(path);
  return svg;
}
