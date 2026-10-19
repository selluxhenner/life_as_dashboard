package com.kevinschmid.lifeos.pulse;

import android.Manifest;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.kevinschmid.lifeos.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lina, hands-free. A microphone foreground service that, while the phone is unlocked, listens on the phone for
 * "Hey Lina" (Wake), then records until Kevin pauses, sends it to the server (/api/voice/turn) and plays the answer.
 * If she asks something back ("Shall I send Max the invite?") she listens again without the wake word.
 * The assistant gesture (AssistActivity: long-press power / home) starts the same conversation straight away.
 * Before the wake word nothing leaves the phone: the spotter runs locally and keeps only the last 1.5 s in memory.
 * Screen off or locked: the microphone is released (no green dot, no battery), and it resumes on unlock.
 */
public class LinaService extends Service {
    static final String ACT_LISTEN = "com.kevinschmid.lifeos.lina.LISTEN";   // wake word on (Settings, app start)
    static final String ACT_TALK = "com.kevinschmid.lifeos.lina.TALK";       // talk now (assistant gesture, app button)
    static final int ID = 4301, ID_REPLY = 4302;
    static final String CH_WAKE = "lina_wake", CH_REPLY = "lina";
    private static final String TAG = "Lina";
    private static final int RATE = Wake.RATE, FRAME = RATE / 10;           // 100 ms
    private static final int PRE_ROLL = RATE * 3 / 2;                         // "Hey Lina" goes up with the question
    // Quiet that ends what he says. A short command ends fast once the server has read it as a whole request; after a
    // longer stretch of talking he may just be thinking, so she waits longer. Up to MAX_MS in one go.
    private static final int END_MS = 800, FINISHED_MS = 450, UNSURE_MS = 1200, OPEN_MS = 2500, LONG_MS = 1800, LONG_DONE_MS = 900, LONG_SPEECH_MS = 5000;
    private static final int MAX_MS = 360000;                                  // 6 minutes in one go: effectively no limit
    private static final int ACK_MIN_MS = 4000;                               // after this much talking she says "Okay, got it" at once
    private static final int PAUSE_MS = 250;                                  // at this much quiet the words so far go up
    private static volatile boolean alive;

    private final Object gate = new Object();
    private volatile boolean running, talkNow, unlocked = true, destroyed;
    private volatile String state = "idle";
    private boolean model;
    private Thread loop;
    private BroadcastReceiver screen;
    private TextToSpeech tts;

    static boolean running() { return alive; }

    static boolean hasMic(Context c) { return ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }

    /** Callers must hold the microphone permission and be in the foreground (an activity, the app). */
    static void start(Context c, String action) {
        if (!hasMic(c)) return;
        ContextCompat.startForegroundService(c, new Intent(c, LinaService.class).setAction(action));
    }

    static void stop(Context c) { c.stopService(new Intent(c, LinaService.class)); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        alive = true;
        channels(this);
        model = Wake.available(this);
        unlocked = unlockedNow();
        screen = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                unlocked = !Intent.ACTION_SCREEN_OFF.equals(i.getAction()) && unlockedNow();
                synchronized (gate) { gate.notifyAll(); }
            }
        };
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(this, screen, f, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            ServiceCompat.startForeground(this, ID, notice(), Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
        } catch (Exception e) {                    // no microphone permission, or Android refused it from the background
            Log.w(TAG, "cannot listen: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACT_TALK.equals(intent.getAction())) talkNow = true;
        if (loop == null) {
            running = true;
            loop = new Thread(this::run, "lina");
            loop.start();
        }
        synchronized (gate) { gate.notifyAll(); }
        return START_NOT_STICKY;                   // Android may not restart a microphone service from the background anyway
    }

    @Override
    public void onDestroy() {
        running = false;
        destroyed = true;
        alive = false;
        synchronized (gate) { gate.notifyAll(); }
        try { unregisterReceiver(screen); } catch (Exception ignored) { /* not registered */ }
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    private boolean unlockedNow() {
        boolean on = getSystemService(PowerManager.class).isInteractive();
        return on && !getSystemService(KeyguardManager.class).isKeyguardLocked();
    }

    /* ---------- the loop: wait for the wake word (or a "talk now"), then hold a conversation ---------- */

    private void run() {
        Prefs prefs = Prefs.of(this);
        Wake wake = null;
        Source rec = null;
        short[] pcm = new short[FRAME];
        float[] f = new float[FRAME];
        short[] ring = new short[PRE_ROLL];
        int ringPos = 0;
        boolean ringFull = false;
        try {
            while (running) {
                boolean listen = prefs.linaWake() && unlocked && model;
                if (!talkNow && !listen) {
                    if (rec != null) { rec.release(); rec = null; }
                    if (!prefs.linaWake() || !model) break;             // nothing left to do
                    setState("paused");
                    synchronized (gate) { if (!talkNow && running) gate.wait(30000); }
                    continue;
                }
                if (rec == null) {
                    rec = open();
                    if (rec == null) { reply(getString(R.string.lina_label), "The microphone is busy or blocked.", null, null); break; }
                    ringPos = 0; ringFull = false;
                }
                if (talkNow) {
                    talkNow = false;
                    converse(rec, null, prefs);
                    if (wake != null) wake.reset();
                    ringPos = 0; ringFull = false;
                    continue;
                }
                if (wake == null) wake = new Wake(this, prefs.linaSensitivity());
                setState("idle");
                int n = rec.read(pcm, 0, FRAME);
                if (n <= 0) continue;
                for (int i = 0; i < n; i++) {
                    f[i] = pcm[i] / 32768f;
                    ring[ringPos++] = pcm[i];
                    if (ringPos == ring.length) { ringPos = 0; ringFull = true; }
                }
                String heard = wake.feed(n == FRAME ? f : java.util.Arrays.copyOf(f, n));
                if (heard == null) continue;
                Log.i(TAG, "wake: " + heard);
                short[] pre = new short[ringFull ? ring.length : ringPos];
                if (ringFull) {
                    System.arraycopy(ring, ringPos, pre, 0, ring.length - ringPos);
                    System.arraycopy(ring, 0, pre, ring.length - ringPos, ringPos);
                } else System.arraycopy(ring, 0, pre, 0, ringPos);
                converse(rec, pre, prefs);
                wake.reset();
                ringPos = 0; ringFull = false;
            }
        } catch (InterruptedException ignored) {
            // stopping
        } catch (Throwable t) {
            Log.e(TAG, "stopped", t);
            reply(getString(R.string.lina_label), "Lina stopped listening: " + t.getMessage(), null, null);
        } finally {
            if (rec != null) rec.release();
            if (wake != null) wake.release();
            running = false;
            loop = null;
            if (!destroyed) stopSelf();                             // never stop a newer instance (sensitivity restart)
        }
    }

    /** Where the audio comes from: the microphone, or in a debuggable build a test file (see TestWav). */
    interface Source { int read(short[] buf, int off, int n); void flush(); void release(); }

    private Source open() {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            File test = new File(getFilesDir(), "lina-test.wav");
            File used = new File(getFilesDir(), "lina-test.used.wav");
            if (test.exists() && test.renameTo(used)) { Log.i(TAG, "test audio instead of the microphone"); return new TestWav(used); }
        }
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            AudioRecord r = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE * 2));
            if (r.getState() != AudioRecord.STATE_INITIALIZED) { r.release(); return null; }
            r.startRecording();
            return new Source() {
                public int read(short[] buf, int off, int n) { return r.read(buf, off, n); }
                public void flush() { r.stop(); r.startRecording(); }
                public void release() { r.release(); }
            };
        } catch (SecurityException e) { return null; }
    }

    /** Debug builds only: a 16 kHz mono WAV pushed to files/lina-test.wav plays once in place of the microphone (in real
        time, then silence), so the whole chain can be tested on an emulator without a microphone. */
    private static final class TestWav implements Source {
        private final java.io.DataInputStream in;
        private boolean done;
        TestWav(File f) {
            java.io.DataInputStream d = null;
            try { d = new java.io.DataInputStream(new java.io.BufferedInputStream(new java.io.FileInputStream(f))); d.skipBytes(44); }
            catch (Exception e) { done = true; }
            in = d;
        }
        public int read(short[] buf, int off, int n) {
            try { Thread.sleep(n * 1000L / RATE); } catch (InterruptedException ignored) { /* stopping */ }
            for (int i = 0; i < n; i++) {
                if (done) { buf[off + i] = 0; continue; }
                try { int lo = in.read(), hi = in.read(); if (hi < 0) { done = true; buf[off + i] = 0; } else buf[off + i] = (short) ((hi << 8) | lo); }
                catch (Exception e) { done = true; buf[off + i] = 0; }
            }
            return n;
        }
        public void flush() { }
        public void release() { try { in.close(); } catch (Exception ignored) { /* closed */ } }
    }

    /**
     * One conversation: up to six turns while Lina keeps asking back. pre = the audio around the wake word (null when
     * started by the assistant gesture).
     */
    private void converse(Source rec, short[] pre, Prefs prefs) throws InterruptedException {
        warm(prefs);
        Live live = new Live();
        openLive(live, prefs);                                           // connects while the first turn starts
        try { converseTurns(rec, pre, prefs, live); } finally { live.close(); }
        setState("idle");
    }

    private void converseTurns(Source rec, short[] pre, Prefs prefs, Live live) throws InterruptedException {
        String cid = prefs.linaConversation();
        String awaiting = "";
        for (int turn = 0; turn < 6 && running; turn++) {
            cue(turn == 0);
            setState("listening");
            Prep prep = new Prep();
            live.reset();
            byte[] speech = record(rec, pre, pre != null ? 5000 : 7000, prep, prefs, live);
            if (speech == null) {                                    // he said nothing (more)
                if (pre == null && turn == 0) reply(getString(R.string.lina_label), "Didn't hear anything. Try again.", null, null);
                break;
            }
            setState("thinking");
            Thread ack = prep.talkMs >= ACK_MIN_MS && live.on() ? ack(guessLang(live.stt.text())) : null;   // spoken while the answer is worked out
            JSONObject r;
            try {
                String q = "?wake=" + (pre != null ? "1" : "0") + (ack != null ? "&acked=1" : "")
                    + (cid.isEmpty() ? "" : "&conversationId=" + URLEncoder.encode(cid, "UTF-8"))
                    + (awaiting.isEmpty() ? "" : "&awaiting=" + URLEncoder.encode(awaiting, "UTF-8"));
                String pid = prep.id;
                if (pid != null) {
                    try { r = Server.postAudio(prefs, "/api/voice/turn" + q + "&prepared=" + URLEncoder.encode(pid, "UTF-8"), new byte[0], "audio/wav"); }
                    catch (java.io.IOException gone) { r = Server.postAudio(prefs, "/api/voice/turn" + q, wav(speech), "audio/wav"); }   // expired: send the audio
                } else r = Server.postAudio(prefs, "/api/voice/turn" + q, wav(speech), "audio/wav");
            } catch (Exception e) {
                joinAck(ack);
                Log.w(TAG, "turn failed", e);
                String msg = e.getMessage() == null ? "Lina couldn't reach your server." : e.getMessage();
                reply("Lina couldn't answer", msg, null, null);
                speakLocal("Sorry, I couldn't reach your server.", "en");
                break;
            }
            joinAck(ack);                                                // her answer follows right after the acknowledgement
            if (r.optBoolean("falseWake")) { Log.i(TAG, "not for Lina"); break; }
            cid = r.optString("conversationId", cid);
            if (!cid.isEmpty()) prefs.setLinaConversation(cid);
            String heard = r.optString("heard", ""), text = r.optString("reply", "");
            JSONArray wait = r.optJSONArray("awaiting");
            awaiting = ids(wait);
            if (text.isEmpty()) break;
            reply(heard.isEmpty() ? getString(R.string.lina_label) : "“" + heard + "”", text, wait, awaiting);
            setState("speaking");
            play(r.optString("audio", ""), text, r.optString("lang", "en"));
            if (!r.optBoolean("listen")) break;
            pre = null;
            rec.flush();                                               // drop what the mic caught while she spoke
        }
    }

    /** Live transcription for one conversation: audio waits in `early` until the connection is up, then streams. */
    private static final class Live {
        volatile LiveStt stt;
        volatile boolean failed, closed;
        List<short[]> early = new ArrayList<>();
        volatile long peekAt;
        volatile String peeked = "";
        void feed(short[] buf, int n) {
            short[] copy = java.util.Arrays.copyOf(buf, n);
            LiveStt l = stt;
            if (l != null) {
                List<short[]> e;
                synchronized (this) { e = early; early = null; }
                if (e != null) for (short[] c : e) l.send(c, c.length);
                l.send(copy, n);
            } else if (!failed) synchronized (this) { if (early != null && early.size() < 600) early.add(copy); }
        }
        boolean on() { LiveStt l = stt; return l != null && l.ok(); }
        void reset() { LiveStt l = stt; if (l != null) l.reset(); peeked = ""; }
        void close() { closed = true; LiveStt l = stt; if (l != null) l.close(); }
    }

    /* ---------- the instant acknowledgement ---------- */

    private static final Pattern DE = Pattern.compile("\\b(ich|du|und|ist|nicht|das|der|die|mit|für|habe|hab|noch|auch|dann|morgen|heute|bitte|kannst|mach|muss|soll|wir|mein|meine)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern EN = Pattern.compile("\\b(i|you|and|is|not|the|that|with|for|have|also|then|tomorrow|today|please|can|make|need|should|we|my)\\b", Pattern.CASE_INSENSITIVE);

    private static String guessLang(String text) {
        int de = 0, en = 0;
        Matcher d = DE.matcher(text), e = EN.matcher(text);
        while (d.find()) de++;
        while (e.find()) en++;
        return de > en ? "de" : "en";
    }

    /** Starts "Okay, got it." (the server's voice, kept on the phone) and returns the thread playing it; null without a file. */
    private Thread ack(String lang) {
        List<File> have = new ArrayList<>();
        for (int i = 0; i < 2; i++) { File f = new File(getFilesDir(), "lina-ack-" + lang + "-" + i + ".mp3"); if (f.length() > 0) have.add(f); }
        if (have.isEmpty()) return null;
        File f = have.get((int) (Math.random() * have.size()));
        Thread t = new Thread(() -> playFile(f), "lina-ack");
        t.start();
        return t;
    }

    private static void joinAck(Thread t) { if (t != null) try { t.join(6000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } }

    /** Keeps the acknowledgements on the phone: fetched once (a few seconds of audio each), so they start without delay. */
    private void fetchAcks(Prefs prefs) {
        new Thread(() -> {
            for (String lang : new String[] { "en", "de" }) for (int i = 0; i < 2; i++) {
                File f = new File(getFilesDir(), "lina-ack-" + lang + "-" + i + ".mp3");
                if (f.length() > 0) continue;
                try {
                    byte[] b = Server.getBytes(prefs, "/api/voice/ack?lang=" + lang + "&n=" + i);
                    if (b != null && b.length > 500) try (FileOutputStream os = new FileOutputStream(f)) { os.write(b); }
                } catch (Exception ignored) { /* next time */ }
            }
        }, "lina-acks").start();
    }

    private void openLive(Live live, Prefs prefs) {
        fetchAcks(prefs);
        new Thread(() -> {
            try {
                JSONObject t = Server.post(prefs, "/api/voice/live-token", new JSONObject());
                LiveStt l = LiveStt.open(t.optString("url") + "?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=manual&token="
                    + URLEncoder.encode(t.optString("token"), "UTF-8"), 2500, all -> peek(live, all, prefs));
                if (l == null || live.closed) { if (l != null) l.close(); live.failed = true; return; }
                live.stt = l;
            } catch (Exception e) { live.failed = true; }       // no ElevenLabs key or no connection: recordings go up as before
        }, "lina-live-open").start();
    }

    /** Thinking while he talks: words that may already be the whole request get their answer voiced ahead. */
    private void peek(Live live, String all, Prefs prefs) {
        long now = System.currentTimeMillis();
        if (all.equals(live.peeked) || now - live.peekAt < 400 || all.trim().split("\\s+").length < 3) return;
        live.peeked = all; live.peekAt = now;
        new Thread(() -> {
            try { Server.post(prefs, "/api/voice/prepare", new JSONObject().put("text", all)); } catch (Exception ignored) { /* only a head start */ }
        }, "lina-peek").start();
    }

    /** Lets the server get Lina's model ready while Kevin is still talking, so the first answer comes sooner. */
    private static void warm(Prefs prefs) {
        new Thread(() -> {
            try { Server.post(prefs, "/api/voice/warm", new JSONObject()); } catch (Exception ignored) { /* only a head start */ }
        }, "lina-warm").start();
    }

    /** What the server made of the words so far: set from a background thread at each short pause. */
    private static final class Prep {
        volatile String id;
        volatile int finished = -1;                                            // -1 not known yet, 0 no, 1 yes
        volatile int gen;
        volatile int talkMs;
        void reset() { gen++; id = null; finished = -1; }
    }

    /** The same with the live words (no upload, no waiting for speech-to-text): the answer comes back at once. */
    private void prepareText(Prep prep, Live live, Prefs prefs) {
        final int gen = ++prep.gen;
        new Thread(() -> {
            try {
                String text = live.stt.commit(800);
                if (text.trim().isEmpty() || prep.gen != gen) return;
                JSONObject j = Server.post(prefs, "/api/voice/prepare", new JSONObject().put("text", text));
                if (prep.gen != gen) return;
                prep.id = j.optString("id", null);
                prep.finished = j.optBoolean("finished", true) ? 1 : 0;
            } catch (Exception ignored) { /* the turn sends the audio itself */ }
        }, "lina-prepare-live").start();
    }

    /** At a short pause the audio so far goes up (/voice/prepare): the server transcribes it, plans and voices the likely
        answer, and says whether it was a whole request, while the phone makes sure he is done. */
    private void prepare(Prep prep, byte[] pcm, Prefs prefs) {
        final int gen = ++prep.gen;
        new Thread(() -> {
            try {
                JSONObject j = Server.postAudio(prefs, "/api/voice/prepare", wav(pcm), "audio/wav");
                String id = j.optString("id", "");
                if (id.isEmpty() || prep.gen != gen) return;
                prep.id = id;
                JSONObject st = Server.get(prefs, "/api/voice/prepare/" + URLEncoder.encode(id, "UTF-8"));
                if (prep.gen == gen) prep.finished = st.optBoolean("finished", true) ? 1 : 0;
            } catch (Exception ignored) { /* only a head start: the turn sends the audio itself */ }
        }, "lina-prepare").start();
    }

    /**
     * Records until Kevin is done: ends after a pause that fits what he said (see the constants), or after `waitMs` if
     * he never starts, at most MAX_MS. A simple energy detector with a moving noise floor; the pre-roll is sent along but
     * doesn't count as the start.
     */
    private byte[] record(Source rec, short[] pre, int waitMs, Prep prep, Prefs prefs, Live live) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (pre != null) { writePcm(out, pre, pre.length); live.feed(pre, pre.length); }
        short[] buf = new short[FRAME];
        double floor = 250;
        boolean speech = false, paused = false;
        int quietMs = 0, ms = 0, talkMs = 0;
        while (running && ms < MAX_MS) {
            int n = rec.read(buf, 0, FRAME);
            if (n <= 0) continue;
            int dur = n * 1000 / RATE;
            ms += dur;
            writePcm(out, buf, n);
            live.feed(buf, n);
            double sum = 0;
            for (int i = 0; i < n; i++) sum += (double) buf[i] * buf[i];
            double rms = Math.sqrt(sum / n);
            if (rms > Math.max(600, floor * 2.5)) {
                speech = true; quietMs = 0;
                if (paused) { paused = false; prep.reset(); }             // he went on: what was sent is out of date
            } else {
                quietMs += dur;
                floor = floor * 0.95 + rms * 0.05;
            }
            if (speech) talkMs += dur;
            if (!speech && ms >= waitMs) return null;
            if (speech && !paused && quietMs >= PAUSE_MS) { paused = true; if (live.on()) prepareText(prep, live, prefs); else prepare(prep, out.toByteArray(), prefs); }
            if (speech && quietMs >= FINISHED_MS) {
                int f = prep.finished;
                int need = talkMs >= LONG_SPEECH_MS ? (f == 0 ? OPEN_MS : f == 1 ? LONG_DONE_MS : LONG_MS)   // a long explanation: he may be thinking
                    : f == 1 ? FINISHED_MS : f == 0 ? OPEN_MS : prep.id != null || paused ? UNSURE_MS : END_MS;
                if (quietMs >= need) break;
            }
        }
        prep.talkMs = talkMs;
        return speech ? out.toByteArray() : null;
    }

    private static void writePcm(ByteArrayOutputStream out, short[] s, int n) {
        for (int i = 0; i < n; i++) { out.write(s[i] & 0xff); out.write((s[i] >> 8) & 0xff); }
    }

    private static byte[] wav(byte[] pcm) {
        ByteArrayOutputStream o = new ByteArrayOutputStream(pcm.length + 44);
        int byteRate = RATE * 2;
        o.write('R'); o.write('I'); o.write('F'); o.write('F'); le32(o, 36 + pcm.length);
        o.write('W'); o.write('A'); o.write('V'); o.write('E');
        o.write('f'); o.write('m'); o.write('t'); o.write(' '); le32(o, 16); le16(o, 1); le16(o, 1);
        le32(o, RATE); le32(o, byteRate); le16(o, 2); le16(o, 16);
        o.write('d'); o.write('a'); o.write('t'); o.write('a'); le32(o, pcm.length);
        o.write(pcm, 0, pcm.length);
        return o.toByteArray();
    }
    private static void le32(ByteArrayOutputStream o, int v) { for (int i = 0; i < 4; i++) o.write((v >> (8 * i)) & 0xff); }
    private static void le16(ByteArrayOutputStream o, int v) { o.write(v & 0xff); o.write((v >> 8) & 0xff); }

    private static String ids(JSONArray a) {
        if (a == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < a.length(); i++) {
            String id = a.optJSONObject(i) == null ? "" : a.optJSONObject(i).optString("id", "");
            if (!id.isEmpty()) b.append(b.length() > 0 ? "," : "").append(id);
        }
        return b.toString();
    }

    /* ---------- sound ---------- */

    /** A short buzz (and a soft tick for a follow-up) so Kevin knows she is listening. */
    private void cue(boolean first) {
        try {
            Vibrator v = getSystemService(Vibrator.class);
            if (v != null && Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(first ? 45 : 25, VibrationEffect.DEFAULT_AMPLITUDE));
            if (!first) { ToneGenerator t = new ToneGenerator(AudioManager.STREAM_MUSIC, 35); t.startTone(ToneGenerator.TONE_PROP_ACK, 120); Thread.sleep(160); t.release(); }
        } catch (Exception ignored) { /* no vibrator / tone */ }
    }

    /** Plays the server's voice (ElevenLabs), or the phone's own voice when the server sent none. Blocks until done. */
    private void play(String b64, String text, String lang) {
        AudioManager am = getSystemService(AudioManager.class);
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        AudioFocusRequest focus = Build.VERSION.SDK_INT >= 26 ? new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build() : null;
        if (focus != null) am.requestAudioFocus(focus);
        try {
            if (b64.isEmpty()) { speakLocal(text, lang); return; }
            File f = new File(getCacheDir(), "lina-reply.mp3");
            try (FileOutputStream os = new FileOutputStream(f)) { os.write(Base64.decode(b64, Base64.DEFAULT)); }
            playRaw(f, attrs);
        } catch (Exception e) {
            Log.w(TAG, "play failed", e);
            speakLocal(text, lang);
        } finally {
            if (focus != null) am.abandonAudioFocusRequest(focus);
        }
    }

    /** Plays a short mp3 (the acknowledgement) with its own audio focus. Blocks until done. */
    private void playFile(File f) {
        AudioManager am = getSystemService(AudioManager.class);
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        AudioFocusRequest focus = Build.VERSION.SDK_INT >= 26 ? new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build() : null;
        if (focus != null) am.requestAudioFocus(focus);
        try { playRaw(f, attrs); } catch (Exception e) { Log.w(TAG, "ack failed", e); }
        finally { if (focus != null) am.abandonAudioFocusRequest(focus); }
    }

    private void playRaw(File f, AudioAttributes attrs) throws Exception {
        {
            CountDownLatch done = new CountDownLatch(1);
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(attrs);
            mp.setDataSource(f.getPath());
            mp.setOnCompletionListener(p -> done.countDown());
            mp.setOnErrorListener((p, w, x) -> { done.countDown(); return true; });
            mp.prepare();
            mp.start();
            done.await(Math.max(10, mp.getDuration() / 1000 + 5), TimeUnit.SECONDS);
            mp.release();
        }
    }

    private void speakLocal(String text, String lang) {
        try {
            CountDownLatch ready = new CountDownLatch(1);
            final int[] status = { TextToSpeech.ERROR };
            if (tts == null) tts = new TextToSpeech(this, s -> { status[0] = s; ready.countDown(); });
            else { status[0] = TextToSpeech.SUCCESS; ready.countDown(); }
            if (!ready.await(5, TimeUnit.SECONDS) || status[0] != TextToSpeech.SUCCESS) return;
            tts.setLanguage("de".equals(lang) ? Locale.GERMAN : Locale.ENGLISH);
            CountDownLatch done = new CountDownLatch(1);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { done.countDown(); }
                @Override public void onError(String id) { done.countDown(); }
            });
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lina");
            done.await(30, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) { /* stopping */ }
    }

    /* ---------- notifications ---------- */

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel wake = new NotificationChannel(CH_WAKE, "Lina is listening", NotificationManager.IMPORTANCE_LOW);
        wake.setDescription("Shown while Lina waits for “Hey Lina” (only while the phone is unlocked).");
        wake.setShowBadge(false);
        nm.createNotificationChannel(wake);
        NotificationChannel reply = new NotificationChannel(CH_REPLY, "Lina’s answers", NotificationManager.IMPORTANCE_DEFAULT);
        reply.setDescription("What Lina said, with Send / Don’t send for invitations.");
        reply.setSound(null, null);
        reply.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(reply);
    }

    private void setState(String s) {
        if (s.equals(state)) return;
        state = s;
        try { NotificationManagerCompat.from(this).notify(ID, notice()); } catch (SecurityException ignored) { /* notifications off */ }
    }

    private Notification notice() {
        String text;
        switch (state) {
            case "listening": text = "Listening…"; break;
            case "thinking": text = "Thinking…"; break;
            case "speaking": text = "Speaking…"; break;
            case "paused": text = "Waiting until the phone is unlocked"; break;
            default: text = Prefs.of(this).linaWake() ? "Say “Hey Lina”" : "Ready";
        }
        PendingIntent stop = PendingIntent.getBroadcast(this, 4310, new Intent(this, LinaReceiver.class).setAction(LinaReceiver.STOP), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH_WAKE)
            .setSmallIcon(R.drawable.ic_stat_agentic)
            .setColor(Alerts.SIGNAL)
            .setContentTitle("Lina")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(Alerts.open(this, "assistant", null, 4311))
            .addAction(0, "Stop listening", stop)
            .build();
    }

    /** What Lina said stays as a notification; invitations get Send / Don't send. */
    private void reply(String title, String text, JSONArray waiting, String ids) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH_REPLY)
            .setSmallIcon(R.drawable.ic_stat_agentic)
            .setColor(Alerts.SIGNAL)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(Alerts.open(this, "assistant", null, 4312));
        if (waiting != null && waiting.length() > 0 && ids != null && !ids.isEmpty()) {
            b.addAction(0, "Send", LinaReceiver.decide(this, ids, true));
            b.addAction(0, "Don’t send", LinaReceiver.decide(this, ids, false));
        }
        try { NotificationManagerCompat.from(this).notify(ID_REPLY, b.build()); } catch (SecurityException ignored) { /* notifications off */ }
    }
}
