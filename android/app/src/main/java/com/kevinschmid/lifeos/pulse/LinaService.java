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
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

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
        String cid = prefs.linaConversation();
        String awaiting = "";
        for (int turn = 0; turn < 6 && running; turn++) {
            cue(turn == 0);
            setState("listening");
            byte[] speech = record(rec, pre, pre != null ? 5000 : 7000);
            if (speech == null) {                                    // he said nothing (more)
                if (pre == null && turn == 0) reply(getString(R.string.lina_label), "Didn't hear anything. Try again.", null, null);
                break;
            }
            setState("thinking");
            JSONObject r;
            try {
                String q = "?wake=" + (pre != null ? "1" : "0")
                    + (cid.isEmpty() ? "" : "&conversationId=" + URLEncoder.encode(cid, "UTF-8"))
                    + (awaiting.isEmpty() ? "" : "&awaiting=" + URLEncoder.encode(awaiting, "UTF-8"));
                r = Server.postAudio(prefs, "/api/voice/turn" + q, wav(speech), "audio/wav");
            } catch (Exception e) {
                Log.w(TAG, "turn failed", e);
                String msg = e.getMessage() == null ? "Lina couldn't reach your server." : e.getMessage();
                reply("Lina couldn't answer", msg, null, null);
                speakLocal("Sorry, I couldn't reach your server.", "en");
                break;
            }
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
        setState("idle");
    }

    /**
     * Records until Kevin pauses: ends 1.1 s after the last speech, or after `waitMs` if he never starts, at most 25 s.
     * A simple energy detector with a moving noise floor; the pre-roll is sent along but doesn't count as the start.
     */
    private byte[] record(Source rec, short[] pre, int waitMs) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (pre != null) writePcm(out, pre, pre.length);
        short[] buf = new short[FRAME];
        double floor = 250;
        boolean speech = false;
        int quietMs = 0, ms = 0;
        while (running && ms < 25000) {
            int n = rec.read(buf, 0, FRAME);
            if (n <= 0) continue;
            ms += n * 1000 / RATE;
            writePcm(out, buf, n);
            double sum = 0;
            for (int i = 0; i < n; i++) sum += (double) buf[i] * buf[i];
            double rms = Math.sqrt(sum / n);
            if (rms > Math.max(600, floor * 2.5)) { speech = true; quietMs = 0; }
            else {
                quietMs += n * 1000 / RATE;
                floor = floor * 0.95 + rms * 0.05;
            }
            if (!speech && ms >= waitMs) return null;
            if (speech && quietMs >= 1100) break;
        }
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
        } catch (Exception e) {
            Log.w(TAG, "play failed", e);
            speakLocal(text, lang);
        } finally {
            if (focus != null) am.abandonAudioFocusRequest(focus);
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
