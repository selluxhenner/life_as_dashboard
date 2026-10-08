package com.kevinschmid.lifeos.pulse;

import android.content.Context;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Captures typed into the Capture widget's popup (CaptureActivity). They go straight to the server as "capture:<id>"
 * documents, the same ones the app syncs (src/core/docsync.js), so they show up everywhere without opening the app.
 * Until the server has them they wait in a queue: CaptureWorker retries once the network is back, every pulse check
 * tries too, and the app takes whatever is left when it opens (takeCaptures), which also covers a phone never paired.
 */
final class Captures {
    private static final Object LOCK = new Object();
    private static final String WORK = "agentic-captures";
    private static final int BATCH = 200;                      // the server's limit per sync
    private static final long PAST_EVERY_REV = 9007199254740991L;
    private static final SecureRandom RND = new SecureRandom();

    private Captures() {}

    /** One capture per non-empty line, like captureText() in src/features/capture/captures.js. Returns how many. */
    static int add(Context ctx, String raw) {
        Prefs p = Prefs.of(ctx);
        long now = System.currentTimeMillis();
        int n = 0;
        synchronized (LOCK) {
            JSONArray q = queue(p);
            for (String line : raw.split("\\r?\\n")) {
                String text = line.replaceFirst("^\\s*(?:[-*•]|\\d+[.)])\\s+", "").trim();
                if (!text.isEmpty()) q.put(capture(text, now + n++));
            }
            if (n == 0) return 0;
            p.setCaptureQueue(q.toString());
            p.setUnsorted(p.unsorted() + n);                   // the app reports the real count when it next runs
        }
        CaptureWidget.updateAll(ctx);
        Pulse.BG.execute(() -> { if (!flush(ctx)) retryLater(ctx); });
        return n;
    }

    /** The shape the app writes. `parse` asks the app to read dates ("Fri 15:00") from the text, as it does for its own. */
    private static JSONObject capture(String text, long at) {
        JSONObject c = new JSONObject();
        try {
            c.put("id", "id_" + Long.toString(at, 36) + Integer.toString(60466176 + RND.nextInt(60466176), 36).substring(1));
            c.put("text", text).put("type", "none").put("date", "").put("time", "").put("end", "");
            c.put("horizon", "woche").put("priority", "med").put("createdAt", at).put("updatedAt", at);
            c.put("archived", false).put("ref", JSONObject.NULL).put("from", "widget").put("parse", true);
        } catch (Exception ignored) { /* only fails on non-finite numbers */ }
        return c;
    }

    /** Sends what is queued. False when the server could not be reached, so it is worth trying again later. */
    static boolean flush(Context ctx) {
        Prefs p = Prefs.of(ctx);
        if (!p.configured()) return true;                      // the app takes them when it opens
        for (;;) {
            JSONArray q;
            synchronized (LOCK) { q = queue(p); }
            if (q.length() == 0) return true;
            Set<String> sent = new HashSet<>();
            try {
                JSONArray ups = new JSONArray();
                for (int i = 0; i < q.length() && i < BATCH; i++) {
                    JSONObject c = q.getJSONObject(i);
                    ups.put(new JSONObject().put("key", "capture:" + c.getString("id")).put("value", c).put("updatedAt", c.getLong("updatedAt")));
                    sent.add(c.getString("id"));
                }
                // "since" past every revision: only upload, the app pulls the rest itself
                Server.post(p, "/api/docs/sync", new JSONObject().put("since", PAST_EVERY_REV).put("upserts", ups));
            } catch (Server.AuthException e) {
                return true;                                   // a new pairing is needed; the app takes them meanwhile
            } catch (Exception e) {
                return false;
            }
            synchronized (LOCK) {
                JSONArray left = new JSONArray(), cur = queue(p);
                for (int i = 0; i < cur.length(); i++) {
                    JSONObject c = cur.optJSONObject(i);
                    if (c != null && !sent.contains(c.optString("id"))) left.put(c);
                }
                p.setCaptureQueue(left.toString());
            }
        }
    }

    /** Hands the queue to the app, which adds the captures itself and syncs them with everything else. */
    static JSONArray take(Context ctx) {
        Prefs p = Prefs.of(ctx);
        synchronized (LOCK) {
            JSONArray q = queue(p);
            if (q.length() > 0) p.setCaptureQueue("[]");
            return q;
        }
    }

    /** Once the network is back, with growing pauses while the server stays out of reach. */
    private static void retryLater(Context ctx) {
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(CaptureWorker.class)
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, req);
    }

    private static JSONArray queue(Prefs p) {
        try { return new JSONArray(p.captureQueue()); } catch (Exception e) { return new JSONArray(); }
    }
}
