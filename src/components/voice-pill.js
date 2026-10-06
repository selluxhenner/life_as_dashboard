// Floating voice bar: shows that the agent is listening, thinking or speaking, what it heard and what it answered.
// It lingers a few seconds after the answer so you can read it back or ask again.
import { h } from '../core/dom.js';
import { subscribe } from '../core/store.js';
import { icon } from '../core/icons.js';
import { talk, toggleTalk, cancelTalk } from '../voice/talk.js';

const LINGER = 15000;
const LABEL = { listening: 'Listening — tap Send when you’re done', thinking: 'Thinking…', speaking: 'Speaking', idle: 'Answer' };
const ABOUT = { briefing: 'about your briefing', world: 'about the world' };

export function mountVoicePill() {
  const host = h('div.voice-pill-host', { 'aria-live': 'polite' });
  let shown = '', hideTimer = null;
  const render = () => {
    const recent = talk.state === 'idle' && !!talk.reply && Date.now() - talk.at < LINGER;
    const key = [talk.state, recent, talk.context, talk.heard, talk.reply].join('|');
    if (key === shown) return;                     // re-render only on change, so the animations keep running
    shown = key;
    clearTimeout(hideTimer);
    if (talk.state === 'idle' && !recent) { host.replaceChildren(); return; }
    if (recent) hideTimer = setTimeout(render, LINGER - (Date.now() - talk.at) + 50);
    const st = talk.state;
    const action = st === 'listening' ? h('button.btn.sm.primary', { type: 'button', onclick: () => toggleTalk() }, 'Send')
      : st === 'speaking' ? h('button.btn.sm', { type: 'button', onclick: () => toggleTalk() }, icon('pause'), 'Stop')
      : recent ? h('button.btn.sm', { type: 'button', onclick: () => toggleTalk(talk.context) }, icon('mic'), 'Ask again') : null;
    host.replaceChildren(h('div.voice-pill', { role: 'status', dataset: { state: st } },
      h('span.vp-orb', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      h('div.vp-main',
        h('div.vp-head', h('span.vp-label', LABEL[st]), talk.context ? h('span.micro', ABOUT[talk.context]) : null),
        talk.heard ? h('div.vp-heard', '“' + talk.heard + '”') : null,
        talk.reply && (st === 'speaking' || recent) ? h('div.vp-reply', talk.reply) : null),
      action,
      h('button.vp-close', { type: 'button', 'aria-label': 'Close voice', title: 'Close', onclick: cancelTalk }, icon('x'))));
  };
  subscribe(render);
  render();
  return host;
}
