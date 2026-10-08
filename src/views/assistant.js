import { h } from '../core/dom.js';
import { notify } from '../core/store.js';
import { fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, empty, chip, btn } from '../components/ui.js';
import { apiConfig, api, errorText } from '../core/api.js';
import { remote, refresh } from '../core/remote.js';
import { icon } from '../core/icons.js';
import { speak, stopSpeaking } from '../voice/tts.js';
import { canRecord, startRecording, stopRecording, transcribe } from '../voice/stt.js';
import { warmLina } from '../voice/turn.js';
import { toast, tick } from '../core/fx.js';
import { runSync } from '../core/sync.js';

const CONV_KEY = 'agenticConversation';
let conv = (() => { try { return JSON.parse(localStorage.getItem(CONV_KEY)) || { id: null, messages: [] }; } catch { return { id: null, messages: [] }; } })();
let streaming = false, recording = false, voiceReply = false;
const persistConv = () => localStorage.setItem(CONV_KEY, JSON.stringify({ id: conv.id, messages: conv.messages.slice(-60) }));

export const pendingActions = () => remote('actions', '/api/agent/actions?status=pending', 60000);

/**
 * Sends a message to the agent and streams the reply into the shared chat. Returns the reply text (null if not sent).
 * context = what Kevin just listened to ('briefing' | 'world'); speakReply defaults to "came in by voice or Speak replies on".
 */
export async function sendToAgent(text, { viaVoice = false, context = null, speakReply } = {}) {
  if (!text.trim() || streaming) return null;
  const cfg = apiConfig();
  if (!cfg) { toast('Pair this device in Settings to talk to Lina.', 'amber'); return null; }
  conv.messages.push({ role: 'user', text, at: Date.now() });
  const reply = { role: 'assistant', text: '', tools: [], at: Date.now() };
  conv.messages.push(reply);
  streaming = true; notify();
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/agent/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ conversationId: conv.id, message: text, channel: viaVoice ? 'voice' : 'chat', context })
    });
    if (!res.ok || !res.body) throw { kind: res.status === 401 ? 'auth' : 'server', msg: 'HTTP ' + res.status };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^data:\s?/gm, '');
        buf = buf.slice(i + 2);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'start') conv.id = ev.conversationId;
        else if (ev.type === 'text') reply.text += ev.text;
        else if (ev.type === 'tool') reply.tools.push({ name: ev.name, status: ev.status, summary: ev.summary });
        else if (ev.type === 'error') reply.text += '\n[' + ev.message + ']';
        notify();
      }
    }
  } catch (e) {
    reply.text = reply.text || errorText(e);
  } finally {
    streaming = false;
    persistConv();
    notify();
    if (reply.tools.length) { runSync(); refresh('actions', '/api/agent/actions?status=pending'); }
    if ((speakReply ?? (viaVoice || voiceReply)) && reply.text) speak(reply.text, null, { what: 'talk' });
  }
  return reply.text;
}
const send = (text, opts) => sendToAgent(text, opts);

/* Push-to-talk shares this conversation: a spoken turn continues it and lands in the chat like a typed one. */
export const chatConversationId = () => conv.id;
export function logVoiceExchange({ conversationId, heard, reply, tools = [] }) {
  if (!heard) return;
  conv.id = conversationId || conv.id;
  const at = Date.now();
  conv.messages.push({ role: 'user', text: heard, at }, { role: 'assistant', text: reply || '', tools, at });
  persistConv();
  notify();
  if (tools.length) runSync();
  refresh('actions', '/api/agent/actions?status=pending');      // a spoken yes/no decides one without any tool call
}

async function toggleRecord(btnEl) {
  if (!recording) {
    try { stopSpeaking(); await startRecording(); recording = true; warmLina(); tick('open'); btnEl.classList.add('rec'); }
    catch { toast('Microphone permission denied.', 'flare'); }
    return;
  }
  recording = false; btnEl.classList.remove('rec');
  const blob = await stopRecording();
  if (!blob) return;
  try { const text = await transcribe(blob); if (text) send(text, { viaVoice: true }); else toast('Didn’t catch that.', 'amber'); }
  catch (e) { toast(e.message || 'Transcription failed', 'flare'); }
}

function message(m) {
  return h('div.msg.' + m.role,
    m.role === 'assistant' && m.tools && m.tools.length ? h('div.msg-tools', m.tools.map(t => chip(t.summary || t.name, t.status === 'pending' ? 'warn' : 'signal'))) : null,
    h('div.msg-text', m.text || (streaming && m.role === 'assistant' ? h('span.typing', h('i'), h('i'), h('i')) : '')));
}

function approvals() {
  const { data, connected } = pendingActions();
  const items = (data && data.actions) || [];
  const decide = async (a, ok) => {
    try {
      const r = await api.post(`/api/agent/actions/${a.id}/${ok ? 'approve' : 'reject'}`);
      if (ok && r.openUrl) window.open(r.openUrl, '_blank', 'noopener');
      toast(ok ? 'Approved' : 'Rejected', ok ? 'pulse' : 'ink-3');
    } catch (e) { toast(errorText(e), 'flare'); }
    refresh('actions', '/api/agent/actions?status=pending');
  };
  return panel({ title: 'Needs your approval', readout: items.length ? h('span', h('b', String(items.length)), ' pending') : '' },
    !connected ? empty('Nothing to approve', 'Approvals appear here when Lina wants to send something on your behalf, like a meeting invitation.')
      : items.length ? h('div.approvals', items.map(a => h('article.approval',
          h('div.ap-head', chip(a.tool.replace(/_/g, ' '), 'warn'), h('span.data.muted', fmt.ago(a.createdAt))),
          h('div.ap-summary', a.summary || ''),
          a.preview ? h('pre.ap-preview', a.preview) : null,
          h('div.input-row', h('button.btn.primary', { type: 'button', onclick: () => decide(a, true) }, 'Approve'), h('button.btn.ghost', { type: 'button', onclick: () => decide(a, false) }, 'Reject')))))
      : empty('All clear', 'Nothing waiting for you.'));
}

function activity() {
  const { data } = remote('runs', '/api/agent/runs?limit=12', 2 * 60000);
  const runs = (data && data.runs) || [];
  return panel({ title: 'Background work', readout: 'automatic jobs' },
    runs.length ? h('div.rows', runs.map(r => h('div.row',
      h('span', { class: 'status-dot ' + r.status }),
      h('div.grow', h('div.title', r.summary || r.trigger), h('div.sub', r.trigger + ' · ' + fmt.ago(r.startedAt))))))
      : empty('No runs yet', 'Triage, meeting prep and job nudges will show up here.'));
}

export default {
  id: 'assistant',
  render(root) {
    const log = h('div.chat-log', conv.messages.length ? conv.messages.map(message)
      : h('div.chat-empty',
          h('p', 'Hi, I’m Lina. Ask about your day, inbox or job hunt, or tell me to plan something, in English, German or Swiss German.'),
          h('div.suggestions', ['What’s my day like?', 'Schedule a meeting at 3pm with my business partner', 'Summarise unread emails', 'Which applications need a follow-up?']
            .map(s => h('button.btn.sm', { type: 'button', onclick: () => send(s) }, s)))));
    const input = h('textarea.field.chat-input', { rows: 1, placeholder: streaming ? 'Thinking…' : 'Message Lina', 'aria-label': 'Message',
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = input.value; input.value = ''; send(v); } } });
    const mic = h('button.btn.icon.mic', { type: 'button', 'aria-label': 'Hold to talk', title: 'Talk (click to start, click to send)', disabled: !canRecord(), onclick: () => toggleRecord(mic) }, icon('mic'));
    if (recording) mic.classList.add('rec');
    root.append(h('div.view.assistant',
      viewHead('Lina', 'Your assistant reads your calendar, inbox and tasks, plans meetings and to-dos, and only touches the outside world (invites, emails) with your OK. Say “Hey Lina” on your phone.',
        h('label.inline-toggle', h('input', { type: 'checkbox', checked: voiceReply, onchange: e => { voiceReply = e.target.checked; } }), 'Speak replies'),
        btn('New chat', () => { conv = { id: null, messages: [] }; persistConv(); notify(); }, 'ghost')),
      h('div.grid.g-assist',
        panel({ cls: 'chat' }, log, h('div.chat-bar', mic, input, h('button.btn.primary', { type: 'button', disabled: streaming, onclick: () => { const v = input.value; input.value = ''; send(v); } }, 'Send'))),
        h('div.stack', approvals(), activity()))));
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    const ask = sessionStorage.getItem('agenticAsk');
    if (ask) { sessionStorage.removeItem('agenticAsk'); setTimeout(() => send(ask), 0); }
  }
};
