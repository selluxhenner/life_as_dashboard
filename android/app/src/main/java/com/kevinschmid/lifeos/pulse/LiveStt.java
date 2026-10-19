package com.kevinschmid.lifeos.pulse;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.SSLSocketFactory;

/**
 * Live transcription while Kevin talks, the phone's twin of src/voice/live.js: 16 kHz PCM streams to ElevenLabs Scribe
 * v2 Realtime over a WebSocket (a small RFC 6455 client, no library) so his words are written down by the time he stops.
 * The server hands out a single-use token (/api/voice/live-token). Kevin's own pause detection decides when a piece is
 * done: commit() asks Scribe to finalise what it heard since the last commit. Anything that goes wrong closes it
 * (ok() turns false) and the caller falls back to sending the recording.
 * Plain JDK only, so it is also tested off the phone (android/live-test).
 */
final class LiveStt {
    interface Listener { void partial(String all); }

    private static final SecureRandom RND = new SecureRandom();
    private final Socket sock;
    private final InputStream in;
    private final OutputStream out;
    private final Object lock = new Object();
    private final List<String> committed = new ArrayList<>();
    private String partial = "";
    private volatile boolean ok = true, started;
    private int commits;                                                   // committed_transcript messages seen
    private final Listener listener;
    private static final Pattern TYPE = Pattern.compile("\"message_type\"\\s*:\\s*\"([^\"]*)\"");

    private LiveStt(Socket s, Listener l) throws IOException {
        sock = s; in = s.getInputStream(); out = s.getOutputStream(); listener = l;
    }

    /** Connects and waits (up to waitMs) for Scribe's session_started; null when it doesn't work. */
    static LiveStt open(String url, int waitMs, Listener l) {
        LiveStt live = null;
        try {
            URI u = URI.create(url);
            boolean tls = "wss".equals(u.getScheme()) || "https".equals(u.getScheme());
            int port = u.getPort() > 0 ? u.getPort() : tls ? 443 : 80;
            Socket s = new Socket();
            s.connect(new InetSocketAddress(u.getHost(), port), 4000);
            if (tls) s = ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(s, u.getHost(), port, true);
            s.setTcpNoDelay(true);
            byte[] k = new byte[16];
            RND.nextBytes(k);
            String key = Base64.getEncoder().encodeToString(k);
            String path = (u.getRawPath().isEmpty() ? "/" : u.getRawPath()) + (u.getRawQuery() == null ? "" : "?" + u.getRawQuery());
            String req = "GET " + path + " HTTP/1.1\r\nHost: " + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "") + "\r\nUpgrade: websocket\r\n"
                + "Connection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
            s.getOutputStream().write(req.getBytes(StandardCharsets.US_ASCII));
            s.getOutputStream().flush();
            s.setSoTimeout(waitMs);
            String head = readHeaders(s.getInputStream());
            if (!head.startsWith("HTTP/1.1 101")) { s.close(); return null; }
            live = new LiveStt(s, l);
            final LiveStt me = live;
            Thread t = new Thread(me::readLoop, "lina-live");
            t.setDaemon(true);
            t.start();
            long end = System.currentTimeMillis() + waitMs;
            synchronized (me.lock) {
                while (!me.started && me.ok && System.currentTimeMillis() < end) me.lock.wait(Math.max(1, end - System.currentTimeMillis()));
            }
            if (!me.started) { me.close(); return null; }
            s.setSoTimeout(0);
            return me;
        } catch (Exception e) {
            if (live != null) live.close();
            return null;
        }
    }

    private static String readHeaders(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            b.write(c);
            byte[] a = b.toByteArray();
            int n = a.length;
            if (n >= 4 && a[n - 4] == '\r' && a[n - 3] == '\n' && a[n - 2] == '\r' && a[n - 1] == '\n') break;
            if (n > 16000) break;
        }
        return b.toString("ISO-8859-1");
    }

    boolean ok() { return ok && !sock.isClosed(); }

    /** Streams n samples of 16 kHz mono audio. */
    void send(short[] pcm, int n) {
        if (!ok()) return;
        byte[] b = new byte[n * 2];
        for (int i = 0; i < n; i++) { b[2 * i] = (byte) pcm[i]; b[2 * i + 1] = (byte) (pcm[i] >> 8); }
        chunk(b, false);
    }

    private void chunk(byte[] pcm, boolean commit) {
        String json = "{\"message_type\":\"input_audio_chunk\",\"audio_base_64\":\"" + Base64.getEncoder().encodeToString(pcm)
            + "\",\"commit\":" + commit + ",\"sample_rate\":16000}";
        try { frame(1, json.getBytes(StandardCharsets.UTF_8)); } catch (IOException e) { fail(); }
    }

    /** Everything said since reset(), once Scribe has finalised the piece (or after waitMs: the newest partial instead). */
    String commit(int waitMs) {
        if (!ok()) return text();
        int before;
        synchronized (lock) { before = commits; }
        chunk(new byte[640], true);                                         // 20 ms of silence, commit
        long end = System.currentTimeMillis() + waitMs;
        synchronized (lock) {
            try { while (ok && commits == before && System.currentTimeMillis() < end) lock.wait(Math.max(1, end - System.currentTimeMillis())); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        return text();
    }

    String text() {
        synchronized (lock) {
            StringBuilder b = new StringBuilder();
            for (String s : committed) if (!s.isEmpty()) b.append(b.length() > 0 ? " " : "").append(s);
            if (!partial.trim().isEmpty()) b.append(b.length() > 0 ? " " : "").append(partial.trim());
            return b.toString();
        }
    }

    void reset() { synchronized (lock) { committed.clear(); partial = ""; } }

    void close() {
        ok = false;
        try { sock.close(); } catch (IOException ignored) { /* closed */ }
        synchronized (lock) { lock.notifyAll(); }
    }

    private void fail() { close(); }

    /* ---------- WebSocket framing ---------- */

    private synchronized void frame(int op, byte[] payload) throws IOException {
        ByteArrayOutputStream f = new ByteArrayOutputStream(payload.length + 14);
        f.write(0x80 | op);
        int len = payload.length;
        if (len < 126) f.write(0x80 | len);
        else if (len < 65536) { f.write(0x80 | 126); f.write(len >> 8); f.write(len & 0xff); }
        else { f.write(0x80 | 127); for (int i = 7; i >= 0; i--) f.write((int) ((long) len >> (8 * i)) & 0xff); }
        byte[] mask = new byte[4];
        RND.nextBytes(mask);
        f.write(mask);
        for (int i = 0; i < len; i++) f.write(payload[i] ^ mask[i & 3]);
        out.write(f.toByteArray());
        out.flush();
    }

    private void readLoop() {
        DataInputStream d = new DataInputStream(in);
        ByteArrayOutputStream msg = new ByteArrayOutputStream();
        try {
            while (ok) {
                int b0 = d.readUnsignedByte(), b1 = d.readUnsignedByte();
                boolean fin = (b0 & 0x80) != 0;
                int op = b0 & 0x0f;
                long len = b1 & 0x7f;
                if (len == 126) len = d.readUnsignedShort();
                else if (len == 127) len = d.readLong();
                if (len > 8_000_000) break;
                byte[] mask = (b1 & 0x80) != 0 ? new byte[4] : null;
                if (mask != null) d.readFully(mask);
                byte[] p = new byte[(int) len];
                d.readFully(p);
                if (mask != null) for (int i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
                if (op == 8) break;
                if (op == 9) { frame(10, p); continue; }
                if (op == 10) continue;
                msg.write(p);
                if (fin) { handle(new String(msg.toByteArray(), StandardCharsets.UTF_8)); msg.reset(); }
            }
        } catch (Exception ignored) { /* closed or broken */ }
        ok = false;
        synchronized (lock) { lock.notifyAll(); }
    }

    private void handle(String json) {
        Matcher m = TYPE.matcher(json);
        String type = m.find() ? m.group(1) : "";
        String all = null;
        synchronized (lock) {
            if (type.equals("session_started")) started = true;
            else if (type.equals("partial_transcript")) { partial = textOf(json); all = text(); }
            else if (type.equals("committed_transcript")) {
                String t = textOf(json).trim();
                if (!t.isEmpty()) committed.add(t);
                partial = "";
                commits++;
            } else if (type.matches(".*(error|exceeded|limited|invalid).*")) ok = false;
            lock.notifyAll();
        }
        if (all != null && listener != null) listener.partial(all);
    }

    /** The "text" string of a flat JSON message, unescaped. */
    static String textOf(String json) {
        int i = json.indexOf("\"text\"");
        if (i < 0) return "";
        i = json.indexOf('"', json.indexOf(':', i) + 1);
        if (i < 0) return "";
        StringBuilder b = new StringBuilder();
        for (i++; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '"') break;
            if (c != '\\' || i + 1 >= json.length()) { b.append(c); continue; }
            char e = json.charAt(++i);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': break;
                case 'u': if (i + 4 < json.length()) { b.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16)); i += 4; } break;
                default: b.append(e);
            }
        }
        return b.toString();
    }
}
