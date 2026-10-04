export const THEMES = [
  { id: 'orbital', name: 'Orbital', note: 'Cyan signal on deep space', swatches: ['#05070A', '#0B1016', '#4FE3FF', '#7CFFB2', '#FF4D5E'] },
  { id: 'ember', name: 'Ember', note: 'Hardware black, one hot accent', swatches: ['#080808', '#181818', '#FF5A1F', '#FFD23F', '#F2F2F0'] },
  { id: 'aurora', name: 'Aurora', note: 'Frosted glass, violet light', swatches: ['#07060B', '#171427', '#8B7CFF', '#3DDBD9', '#FF6AD5'] }
];

const listeners = new Set();
export const onTheme = fn => listeners.add(fn);

export function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--void').trim();
  listeners.forEach(fn => fn(id));
}
