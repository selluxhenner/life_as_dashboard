import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { panel } from '../components/panel.js';
import { viewHead, seg, toggle, btn, chip, empty, select } from '../components/ui.js';
import { confirmDialog } from '../components/overlay.js';
import { apiConfig, api, errorText, DEFAULT_SERVER, BUILT_IN } from '../core/api.js';
import { pairAndConnect, disconnectSync, runSync, syncStatus } from '../core/sync.js';
import { remote, refresh } from '../core/remote.js';
import { applyTheme, THEMES } from '../core/theme.js';
import { platform } from '../core/platform.js';
import { toast } from '../core/fx.js';
import { fmt } from '../core/dates.js';
import { scheduleCal } from '../core/calendar-sync.js';
import { icon } from '../core/icons.js';
import { speak, stopSpeaking, clearVoiceCache, VOICE_SAMPLES, PREMIUM_VOICES, SPEEDS, voiceSettings, voiceScore, systemVoices } from '../voice/tts.js';

const row = (label, hint, control) => h('div.set-row', h('div.grow', h('div.title', label), hint ? h('div.sub', hint) : null), control);

// Unsaved form input survives re-renders (sync status updates rebuild the view).
const draft = { url: null, token: '' };

function serverPanel() {
  const cfg = apiConfig();
  const url = h('input.field', { type: 'url', value: draft.url ?? (cfg ? cfg.url : DEFAULT_SERVER), 'aria-label': 'Server URL', spellcheck: false, oninput: e => { draft.url = e.target.value; } });
  const token = h('input.field', { type: 'password', placeholder: cfg ? '•••••••• (paired)' : 'Pairing token from the server', 'aria-label': 'Pairing token', autocomplete: 'off', value: draft.token, oninput: e => { draft.token = e.target.value; } });
  const msg = h('div.hint', { role: 'status' });
  const pair = async () => {
    // a build with a built-in server needs no token: "Connect" uses it
    const tok = token.value.trim() || (BUILT_IN && !cfg ? BUILT_IN.token : '');
    if (!url.value.trim() || !tok) { msg.textContent = 'Enter the server URL and the pairing token.'; return; }
    msg.textContent = 'Connecting…';
    try {
      await pairAndConnect(url.value, tok);
      draft.url = null; draft.token = '';
      msg.textContent = 'Connected. This device now syncs with the server.';
      toast('Device connected', 'pulse');
    } catch (e) { msg.textContent = errorText(e); }
  };
  return panel({ title: 'Server', readout: cfg ? h('span', chip(syncStatus.state === 'ok' ? 'connected' : syncStatus.state, syncStatus.state === 'ok' ? 'ok' : 'warn')) : chip('local only', null, 'plain') },
    h('p.dim', { style: { marginBottom: '12px' } }, 'Agentic OS runs its background work (briefing, news, inbox, agent) on your server. This device keeps working offline and syncs when it can.'),
    h('label.label', 'Server URL'), url,
    BUILT_IN ? null : [h('label.label', cfg ? 'Pair again (optional)' : 'Pairing token'), token],
    msg,
    h('div.input-row', { style: { marginTop: '12px' } },
      cfg && BUILT_IN ? null : h('button.btn.primary', { type: 'button', onclick: pair }, cfg ? 'Re-pair' : BUILT_IN ? 'Connect' : 'Pair this device'),
      cfg ? h('button.btn', { type: 'button', onclick: () => runSync() }, 'Sync now') : null,
      cfg ? h('button.btn.danger', { type: 'button', onclick: () => { disconnectSync(); notify(); } }, BUILT_IN ? 'Disconnect' : 'Unpair') : null),
    cfg && state.sync.lastSync ? h('div.hint', `Last sync ${fmt.ago(state.sync.lastSync)} · ${Object.keys(state.sync.dirty).length} local change(s) waiting`) : null);
}

function appearancePanel() {
  const s = state.settings;
  return panel({ title: 'Appearance' },
    h('div.theme-cards', THEMES.map(t => h('button.theme-card' + (s.theme === t.id ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(s.theme === t.id),
      onclick: () => { s.theme = t.id; applyTheme(t.id); save(); }
    }, h('div.swatches', t.swatches.map(c => h('i', { style: { background: c } }))), h('div.title', t.name), h('div.sub', t.note)))),
    row('Motion', 'Calm turns off decorative animation.', seg([{ value: 'full', label: 'Full' }, { value: 'calm', label: 'Calm' }], s.motion, v => { s.motion = v; document.documentElement.dataset.motion = v; save(); }, 'Motion')),
    row('Interface sounds', 'Soft ticks on actions.', toggle(s.sound, v => { s.sound = v; save(); }, 'Interface sounds')),
    row('Home location', 'Used for sunrise, sunset and the map marker.', h('span.data', `${s.home.city} · ${s.home.lat}, ${s.home.lon}`)));
}

function connectionsPanel() {
  const { data, connected, error } = remote('connections', '/api/connections', 60000);
  if (!connected) return panel({ title: 'Connections' }, empty('Pair this device first', 'Google, Slack and Fuxam are connected on the server, so every device sees them.'));
  const list = (data && data.connections) || [];
  const reload = () => refresh('connections', '/api/connections');
  let features = { calendar: true, gmail: true };
  const addGoogle = async () => {
    const win = window.open('', '_blank');
    try {
      const r = await api.post('/api/connections/google/start', { features: Object.keys(features).filter(k => features[k]) });
      if (win) win.location.href = r.url; else location.href = r.url;
      toast('Finish the Google sign-in, then come back here.');
    } catch (e) { if (win) win.close(); toast(errorText(e), 'flare'); }
  };
  const slackToken = h('input.field', { type: 'password', placeholder: 'xoxp-… user token', 'aria-label': 'Slack user token', autocomplete: 'off' });
  const icsUrl = h('input.field', { type: 'url', placeholder: 'Fuxam calendar link (webcal:// or https://)', 'aria-label': 'Fuxam calendar link' });
  const addSlack = async () => {
    if (!slackToken.value.trim()) return;
    try { await api.post('/api/connections/slack', { token: slackToken.value.trim() }); slackToken.value = ''; toast('Slack connected', 'pulse'); reload(); }
    catch (e) { toast(errorText(e), 'flare'); }
  };
  const addIcs = async () => {
    if (!icsUrl.value.trim()) return;
    try {
      const r = await api.post('/api/connections/ics', { url: icsUrl.value.trim(), label: 'School' });
      icsUrl.value = '';
      toast(r.preview && r.preview.length ? `Found ${r.preview.length} upcoming lessons, next: ${r.preview[0].title}` : 'Calendar added', 'pulse');
      reload(); scheduleCal(0, true);
    } catch (e) { toast(errorText(e), 'flare'); }
  };
  const remove = async c => { if (!await confirmDialog({ title: `Disconnect “${c.label || c.account}”?`, message: c.provider === 'google' ? 'Its calendar events and emails disappear from Agentic OS. You can connect it again any time.' : 'Its data disappears from Agentic OS. You can connect it again any time.', confirm: 'Disconnect' })) return; try { await api.del('/api/connections/' + c.id); reload(); } catch (e) { toast(errorText(e), 'flare'); } };
  const icon = { google: 'G', slack: '#', ics: '▦' };
  return panel({ title: 'Connections', readout: list.length + ' connected' },
    error && !data ? h('div.hint', errorText(error)) : null,
    h('div.rows', list.map(c => h('div.row',
      h('span.conn-badge', { style: { '--c': c.color || 'var(--signal)' } }, icon[c.provider] || '?'),
      h('div.grow', h('div.title', c.account || c.label), h('div.sub', [c.provider === 'google' ? (c.features || []).join(' + ') : c.provider === 'ics' ? 'School calendar' : 'Slack · ' + ((c.config && c.config.channels || []).length) + ' channels', c.lastSyncAt ? 'synced ' + fmt.ago(c.lastSyncAt) : null].filter(Boolean).join(' · '))),
      c.status === 'reauth' ? h('button.btn.sm', { type: 'button', onclick: addGoogle }, 'Reconnect') : chip(c.status === 'ok' ? 'ok' : c.status, c.status === 'ok' ? 'ok' : 'alert'),
      c.provider === 'slack' ? h('button.btn.sm.ghost', { type: 'button', onclick: () => pickChannels(c) }, 'Channels') : null,
      h('button.btn.sm.ghost.danger', { type: 'button', onclick: () => remove(c) }, 'Remove')))),
    h('div.conn-add',
      h('div.conn-block', h('div.title', 'Google account'), h('div.sub', 'Calendar and/or Gmail (read-only). Add as many accounts as you like.'),
        h('div.input-row', { style: { marginTop: '8px' } },
          h('label.inline-toggle', h('input', { type: 'checkbox', checked: true, onchange: e => { features.calendar = e.target.checked; } }), 'Calendar'),
          h('label.inline-toggle', h('input', { type: 'checkbox', checked: true, onchange: e => { features.gmail = e.target.checked; } }), 'Gmail'),
          h('button.btn', { type: 'button', onclick: addGoogle }, 'Add Google account'))),
      h('div.conn-block', h('div.title', 'Slack'), h('div.sub', 'Create a Slack app with a user token (scopes in the README), then paste it here.'),
        h('div.input-row', { style: { marginTop: '8px' } }, slackToken, h('button.btn', { type: 'button', onclick: addSlack }, 'Connect'))),
      h('div.conn-block', h('div.title', 'School · Fuxam'), h('div.sub', 'In Fuxam, copy your calendar subscription link.'),
        h('div.input-row', { style: { marginTop: '8px' } }, icsUrl, h('button.btn', { type: 'button', onclick: addIcs }, 'Add')))));
}

async function pickChannels(c) {
  try {
    const r = await api.get('/api/slack/channels');
    const chosen = new Set((c.config && c.config.channels) || []);
    const names = r.channels.map(ch => `${chosen.has(ch.id) ? '[x]' : '[ ]'} ${ch.name}`).join('\n');
    const ans = prompt('Channels to follow (comma-separated names):\n\n' + names, r.channels.filter(ch => chosen.has(ch.id)).map(ch => ch.name).join(', '));
    if (ans == null) return;
    const wanted = ans.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
    const ids = r.channels.filter(ch => wanted.includes(ch.name)).map(ch => ch.id);
    await api.patch('/api/connections/' + c.id, { config: { ...(c.config || {}), channels: ids } });
    refresh('connections', '/api/connections');
    toast(`Following ${ids.length} channel(s)`, 'pulse');
  } catch (e) { toast(errorText(e), 'flare'); }
}

function serverSettingsPanel() {
  const { data, connected } = remote('serverSettings', '/api/settings', 5 * 60000);
  if (!connected || !data) return null;
  const ss = data.settings || {};
  const patch = async (key, value) => {
    try { await api.patch('/api/settings', { [key]: value }); refresh('serverSettings', '/api/settings'); toast('Saved'); }
    catch (e) { toast(errorText(e), 'flare'); }
  };
  const briefing = ss.briefing || { time: '08:00' };
  const phone = ss.phone || {};
  const voice = ss.voice || {};
  const time = h('input.field.narrow', { type: 'time', value: briefing.time, onchange: e => patch('briefing', { ...briefing, time: e.target.value }) });
  const phoneNum = h('input.field', { type: 'tel', value: phone.number || '', placeholder: '+49 …', onchange: e => patch('phone', { ...phone, number: e.target.value }) });
  return panel({ title: 'Automation' },
    row('Morning briefing', 'Generated a few minutes before, then pushed to your devices.', time),
    row('Play the spoken briefing automatically', 'The 30-second version, the first time the app is in front each morning (until noon).', toggle(!!voice.autoRead, v => patch('voice', { ...voice, autoRead: v }), 'Auto-read')),
    h('div.set-sep'),
    row('Phone check-ins (prototype)', `The assistant can call you to collect answers. Hard cap €${phone.monthlyCapEur || 10}/month.`, toggle(!!phone.enabled, v => patch('phone', { ...phone, enabled: v }), 'Phone calls')),
    phone.enabled ? h('div', row('Your number', 'Verified caller ID on Twilio.', phoneNum),
      row('Quiet hours', 'No calls in this window.', h('span.data', (phone.quietHours || ['21:30', '08:30']).join(' → '))),
      h('div.input-row', h('button.btn', { type: 'button', onclick: async () => { try { await api.post('/api/phone/call', { purpose: 'test', questions: ['Is this a good moment to test the call?'] }); toast('Calling you…', 'pulse'); } catch (e) { toast(errorText(e), 'flare'); } } }, 'Test call'))) : null);
}

let voicesLoaded = false;
let previewAudio = null;
const ELEVEN_HINT = 'Add ELEVENLABS_API_KEY to the server’s .env and restart it. Starter ($6/month) covers a daily briefing, World and spoken replies; Creator ($22) if you talk to it a lot. The same key also does speech-to-text.';

/* ElevenLabs (the natural voice). Voice and model live on the server, so every device sounds the same. */
function elevenSection(info, paired) {
  if (!paired || !info) return null;
  if (!info.eleven) return row('Natural voice', 'ElevenLabs isn’t set up on the server yet. ' + ELEVEN_HINT, chip('not set up', 'warn'));
  const e = info.eleven;
  const patchVoice = async patch => {
    try { await api.patch('/api/settings', { voice: patch }); clearVoiceCache(); refresh('voiceInfo', '/api/voice/info'); refresh('serverSettings', '/api/settings'); }
    catch (err) { toast(errorText(err), 'flare'); }
  };
  const { data, error } = remote('elevenVoices', '/api/voice/voices', 60 * 60000);
  // your own voices (cloned, designed, saved from the library) first, then the premade ones
  const voices = ((data && data.voices) || []).slice().sort((a, b) => (a.category === 'premade') - (b.category === 'premade') || a.name.localeCompare(b.name));
  const acc = e.account;
  const credits = acc && acc.limit ? `${acc.tier ? acc.tier + ' plan, ' : ''}${acc.used.toLocaleString('en-GB')} of ${acc.limit.toLocaleString('en-GB')} credits used this month` : 'connected';
  const model = e.models.find(m => m.id === e.model) || e.models[0];
  const pick = v => {
    if (previewAudio) previewAudio.pause();
    if (v.preview) { previewAudio = new Audio(v.preview); previewAudio.play().catch(() => {}); }
    patchVoice({ elevenVoice: v.id });
  };
  return h('div.eleven',
    row('Natural voice', `ElevenLabs, ${credits}. Model: ${model.note}. Tap a voice to hear its sample; it is then used everywhere.`,
      seg(e.models.map(m => ({ value: m.id, label: m.label })), e.model, val => patchVoice({ elevenModel: val }), 'ElevenLabs model')),
    voices.length
      ? h('div.voice-cards.eleven-voices', voices.map(v => h('button.voice-card' + (v.id === e.voiceId ? '.on' : ''), {
          type: 'button', 'aria-pressed': String(v.id === e.voiceId), title: v.description || v.name, onclick: () => pick(v)
        }, h('span.title', v.name), h('span.sub', [v.accent, v.tone, v.gender].filter(Boolean).join(' · ') || v.category))))
      : h('div.hint', error ? 'Couldn’t load the voices: ' + errorText(error) : 'Loading voices…'));
}

function voicePanel() {
  const v = voiceSettings();
  const set = patch => { state.settings.voice = { ...v, ...patch }; save(); };
  if (!voicesLoaded) systemVoices().then(() => { voicesLoaded = true; notify(); });
  const all = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  const paired = !!apiConfig();
  const info = paired ? remote('voiceInfo', '/api/voice/info', 10 * 60000).data : null;
  const server = info && info.tts;                     // 'elevenlabs' | 'openai' | null
  const test = lang => speak(VOICE_SAMPLES[lang], null, { lang });
  const langRow = (lang, name) => {
    const list = all.map(x => [voiceScore(x, lang), x]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    const control = list.length
      ? select([{ value: '', label: 'Best · ' + list[0].name.replace(/^Microsoft |\s*-.*$/g, '') }, ...list.map(x => ({ value: x.name, label: x.name.replace(/^Microsoft |\s*-.*$/g, '') }))],
          v.system[lang] || '', val => set({ system: { ...v.system, [lang]: val } }), name + ' system voice', 'field sm voice-select')
      : chip('none installed', 'warn');
    return row(name + ' voice', list.length ? 'Used for ' + name + ' text when the server voice is off or unreachable.' : 'Add one in Windows Settings › Time & language › Speech › Add voices.',
      h('div.input-row', control, h('button.btn.sm', { type: 'button', onclick: () => test(lang) }, icon('volume'), 'Test')));
  };
  const readout = !paired || v.provider === 'system' || !server ? 'device voice' : server === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI · ' + v.premiumVoice;
  return panel({ title: 'Voice', cls: 'voice-panel', readout },
    row('Language', v.language === 'auto' ? 'Each text is read in its own language: English with an English voice, German with a German one.' : 'Everything is read in English with an English voice.',
      seg([{ value: 'en', label: 'English' }, { value: 'auto', label: 'Match text' }], v.language, val => set({ language: val }), 'Voice language')),
    row('Engine', paired ? 'Auto uses the natural voice from your server and falls back to this device.' : 'Pair the server to unlock the natural voice. Until then this device’s voices are used.',
      seg([{ value: 'auto', label: 'Auto' }, { value: 'premium', label: 'Server' }, { value: 'system', label: 'Device' }], v.provider, val => set({ provider: val }), 'Voice engine')),
    v.provider !== 'system' ? elevenSection(info, paired) : null,
    v.provider !== 'system' && server === 'openai' ? h('div.voice-cards', PREMIUM_VOICES.map(p => h('button.voice-card' + (v.premiumVoice === p.id ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(v.premiumVoice === p.id), disabled: !paired,
      onclick: () => { set({ premiumVoice: p.id }); speak(VOICE_SAMPLES.en, null, { lang: 'en' }); }
    }, h('span.title', p.label), h('span.sub', p.note)))) : null,
    row('Speed', 'How fast every voice talks. Brisk fits a whole briefing into 30 seconds; Fast if you want it even quicker.',
      seg(SPEEDS.map(o => ({ ...o, value: String(o.value) })), String(v.rate), val => { set({ rate: parseFloat(val) }); test('en'); }, 'Speed')),
    langRow('en', 'English'),
    v.language === 'auto' ? langRow('de', 'German') : null,
    h('div.input-row', { style: { marginTop: '8px' } },
      h('button.btn.sm', { type: 'button', onclick: () => test('en') }, icon('play'), 'Test English'),
      v.language === 'auto' ? h('button.btn.sm', { type: 'button', onclick: () => test('de') }, icon('play'), 'Test German') : null,
      h('button.btn.sm.ghost', { type: 'button', onclick: () => { stopSpeaking(); if (previewAudio) previewAudio.pause(); } }, 'Stop')));
}

function usagePanel() {
  const { data, connected } = remote('usage', '/api/usage', 10 * 60000);
  if (!connected || !data) return null;
  const u = data.usage || {};
  return panel({ title: 'Usage this month', readout: data.month || '' },
    h('div.grid.g-3',
      h('div.stat', h('div.k', 'AI'), h('div.v', '$' + (u.aiUsd || 0).toFixed(2), h('small', 'of $' + (u.aiCapUsd || 40)))),
      h('div.stat', h('div.k', 'Voice'), h('div.v', '$' + (u.voiceUsd || 0).toFixed(2))),
      h('div.stat', h('div.k', 'Phone'), h('div.v', '€' + (u.phoneEur || 0).toFixed(2), h('small', 'of €' + (u.phoneCapEur || 10))))));
}

function featuresPanel() {
  const f = state.settings.flags;
  return panel({ title: 'Features' },
    row('Rank & points', 'The old military-rank points system. Your history is kept; nothing is back-filled when you turn it on.', toggle(f.points, v => { f.points = v; save(); }, 'Rank and points')),
    row('Job suggestions', 'Let the server suggest Berlin Werkstudent/part-time roles daily.', toggle(f.jobsAi, v => { f.jobsAi = v; save(); api.patch('/api/settings', { flags: { ...f } }).catch(() => {}); }, 'Job suggestions')));
}

function dataPanel() {
  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `agentic-os-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return panel({ title: 'Data' },
    row('Export', 'Download everything stored on this device as JSON.', btn('Export', exportData)),
    row('Version', null, h('span.data', `v2.0 · ${platform.kind}`)));
}

export default {
  id: 'settings',
  render(root) {
    root.append(h('div.view.settings',
      viewHead('Settings', 'Server, connections, appearance and automation.'),
      h('div.grid.g-2',
        h('div.stack', serverPanel(), connectionsPanel(), serverSettingsPanel()),
        h('div.stack', appearancePanel(), voicePanel(), featuresPanel(), usagePanel(), dataPanel()))));
  }
};
