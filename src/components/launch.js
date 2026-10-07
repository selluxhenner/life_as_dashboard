// Launch sequence: one continuous motion every time the window opens from closed (a cold start, or after
// the close button / Alt+F4 sent it to the tray). The mark draws itself, then pushes towards the viewer and
// dissolves while the app settles in behind it; the map sweep, the panels and the clock's intro start on
// that same beat. Closing is a short fade to the void, so the next open starts from a clean frame.
// Everything that moves is CSS (transform, opacity, stroke), so it stays smooth while the page works.
import { h } from '../core/dom.js';
import { reducedMotion } from '../core/fx.js';

const DRAW = 560;     // the mark draws in
const ARRIVE = 760;   // the cover dissolves and the app settles
const LEAVE = 180;    // close: the app fades to the void
const CALM = 220;     // reduced motion: a plain cross-fade, no mark

const root = document.documentElement;
const wait = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

let cover = null;

/* The cover: an opaque void with the mark not drawn yet. The app builds underneath it. */
export function mountLaunch() {
  if (cover) return;
  cover = h('div.launch-cover', { 'aria-hidden': 'true' },
    h('svg.launch-mark', { viewBox: '0 0 32 32' },
      h('circle.ring', { cx: 16, cy: 16, r: 13, pathLength: 100 }),
      h('path.arc', { d: 'M16 3a13 13 0 0 1 0 26', pathLength: 100 }),
      h('circle.dot', { cx: 16, cy: 16, r: 3.2 })));
  document.body.append(cover);
  root.dataset.launch = 'cover';
}

/* Plays the launch. onHandoff runs when the app starts to arrive: render the view there, so its own intro
   starts on the beat. Resolves once the cover is gone. */
export async function playLaunch(onHandoff) {
  mountLaunch();
  await nextFrame();   // the first visible frame is the bare cover; start from there
  const calm = reducedMotion();
  if (!calm) {
    root.dataset.launch = 'draw';
    await wait(DRAW);
  }
  if (onHandoff) onHandoff();
  root.dataset.launch = calm ? 'calm' : 'arrive';
  await wait(calm ? CALM : ARRIVE);
  delete root.dataset.launch;
}

/* Close: the app fades to the void and the cover stays up for the next open. */
export async function playClose() {
  mountLaunch();
  root.dataset.launch = 'leave';
  if (!reducedMotion()) await wait(LEAVE);
  await nextFrame(); await nextFrame();   // the void is on screen before the window hides
  root.dataset.launch = 'cover';
}
