// Stand-in for ElevenLabs Scribe v2 Realtime, for testing LiveStt.java off the phone. Prints the port.
import { WebSocketServer } from '../../server/node_modules/ws/wrapper.mjs';
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
wss.on('listening', () => console.log(wss.address().port));
wss.on('connection', (ws, req) => {
  if (!/token=tok/.test(req.url)) return ws.close();
  ws.send(JSON.stringify({ message_type: 'session_started', session_id: 's' }));
  let chunks = 0;
  const said = ['Hey Lina, I want to explain "the plan" for tomorrow ü', 'and then another sentence'];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.message_type !== 'input_audio_chunk') return;
    if (m.commit) { ws.send(JSON.stringify({ message_type: 'committed_transcript', text: said.shift() || '' })); chunks = 0; return; }
    if (++chunks === 5) ws.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Hey Lina I want to' }));
  });
});
