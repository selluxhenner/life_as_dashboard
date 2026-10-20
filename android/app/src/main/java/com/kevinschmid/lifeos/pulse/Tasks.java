package com.kevinschmid.lifeos.pulse;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * The Tasks widget's open todos. They come from the server (GET /api/todos) and from the app, which reports its list on
 * every change (AgenticPlugin.setTasks), so the widget is right even on a phone that was never paired. Ticking a task
 * off or adding one in the widget goes straight to the server as a todo upsert (POST /api/sync, last write wins on
 * updatedAt, like the app's own sync). Until the server has it, it waits in a queue: TaskWorker retries once the
 * network is back, every pulse check tries too, and the app takes what is left when it opens (takeTasks).
 */
final class Tasks {
    /** A ticked-off task stays in the list, struck through, this long: time to tap it again to undo. */
    static final long UNDO = 3000;
    private static final Object LOCK = new Object();
    private static final String WORK = "agentic-tasks";
    private static final long PAST_EVERY_REV = 9007199254740991L;   // "since" past every revision: upload only
    private static final SecureRandom RND = new SecureRandom();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private Tasks() {}

    /** What the widget shows: open tasks (and ones ticked off a moment ago), high priority first, then by due date. */
    static List<JSONObject> shown(Context ctx) {
        long now = System.currentTimeMillis();
        List<JSONObject> out = new ArrayList<>();
        JSONArray all;
        synchronized (LOCK) { all = list(Prefs.of(ctx)); }
        for (int i = 0; i < all.length(); i++) {
            JSONObject t = all.optJSONObject(i);
            if (t == null || t.optBoolean("deleted") || t.optString("title").trim().isEmpty()) continue;
            if (t.optBoolean("done") && now - t.optLong("completedAt", 0) > UNDO) continue;
            out.add(t);
        }
        Collections.sort(out, (a, b) -> {
            int c = Integer.compare(rank(a.optString("priority")), rank(b.optString("priority")));
            if (c != 0) return c;
            String da = a.isNull("due") ? "" : a.optString("due"), db = b.isNull("due") ? "" : b.optString("due");
            if (!da.equals(db)) return da.isEmpty() ? 1 : db.isEmpty() ? -1 : da.compareTo(db);
            return Double.compare(a.optDouble("sort", 0), b.optDouble("sort", 0));
        });
        return out;
    }

    static int open(Context ctx) {
        int n = 0;
        for (JSONObject t : shown(ctx)) if (!t.optBoolean("done")) n++;
        return n;
    }

    private static int rank(String priority) { return "high".equals(priority) ? 0 : "low".equals(priority) ? 2 : 1; }

    /** Tick off (or, within the undo time, untick) a task. */
    static void toggle(Context ctx, String id) {
        Prefs p = Prefs.of(ctx);
        synchronized (LOCK) {
            JSONArray all = list(p);
            JSONObject t = null;
            for (int i = 0; i < all.length() && t == null; i++) {
                JSONObject o = all.optJSONObject(i);
                if (o != null && id.equals(o.optString("id"))) t = o;
            }
            if (t == null) return;
            long now = System.currentTimeMillis();
            boolean done = !t.optBoolean("done");
            try {
                t.put("done", done).put("completedAt", done ? now : JSONObject.NULL).put("updatedAt", Math.max(now, t.optLong("updatedAt") + 1));
            } catch (Exception ignored) { return; }
            p.setTasks(all.toString(), false);
            enqueue(p, t);
        }
        TaskWidget.updateAll(ctx);
        MAIN.postDelayed(() -> TaskWidget.updateAll(ctx), UNDO + 100);        // then it leaves the list
        sendSoon(ctx);
    }

    /** One task per non-empty line, like the Capture widget. Returns how many. */
    static int add(Context ctx, String raw) {
        Prefs p = Prefs.of(ctx);
        long now = System.currentTimeMillis();
        int n = 0;
        synchronized (LOCK) {
            JSONArray all = list(p);
            for (String line : raw.split("\\r?\\n")) {
                String title = line.replaceFirst("^\\s*(?:[-*•]|\\d+[.)])\\s+", "").trim();
                if (title.isEmpty()) continue;
                if (title.length() > 500) title = title.substring(0, 500);
                JSONObject t = todo(title, now + n++);
                all.put(t);
                enqueue(p, t);
            }
            if (n == 0) return 0;
            p.setTasks(all.toString(), false);
        }
        TaskWidget.updateAll(ctx);
        sendSoon(ctx);
        return n;
    }

    /** The shape makeTask() in src/core/migrations.js writes. */
    private static JSONObject todo(String title, long at) {
        JSONObject t = new JSONObject();
        try {
            t.put("id", "id_" + Long.toString(at, 36) + Integer.toString(60466176 + RND.nextInt(60466176), 36).substring(1));
            t.put("title", title).put("notes", "").put("done", false).put("priority", "med").put("due", JSONObject.NULL);
            t.put("project", JSONObject.NULL).put("sort", at).put("source", "widget").put("createdAt", at).put("updatedAt", at);
            t.put("completedAt", JSONObject.NULL).put("deleted", false);
        } catch (Exception ignored) { /* only fails on non-finite numbers */ }
        return t;
    }

    /** The app's list (every live todo). What is still queued here is newer, so it stays on top. */
    static void fromApp(Context ctx, JSONArray todos) {
        Prefs p = Prefs.of(ctx);
        synchronized (LOCK) { p.setTasks(withQueue(p, todos).toString(), false); }
        TaskWidget.updateAll(ctx);
    }

    /** Fetches the list from the server. False when it could not be reached. */
    static boolean refresh(Context ctx) {
        Prefs p = Prefs.of(ctx);
        if (!p.configured()) return true;
        flush(ctx);
        JSONArray todos;
        try { todos = Server.get(p, "/api/todos").optJSONArray("todos"); } catch (Exception e) { return false; }
        if (todos == null) return true;
        synchronized (LOCK) { p.setTasks(withQueue(p, todos).toString(), true); }
        TaskWidget.updateAll(ctx);
        return true;
    }

    /** Sends what is queued. False when the server could not be reached, so it is worth trying again later. */
    static boolean flush(Context ctx) {
        Prefs p = Prefs.of(ctx);
        if (!p.configured()) return true;                       // the app takes them when it opens
        JSONArray q;
        synchronized (LOCK) { q = queue(p); }
        if (q.length() == 0) return true;
        Map<String, Long> sent = new HashMap<>();
        try {
            for (int i = 0; i < q.length(); i++) { JSONObject t = q.getJSONObject(i); sent.put(t.getString("id"), t.getLong("updatedAt")); }
            Server.post(p, "/api/sync", new JSONObject().put("since", PAST_EVERY_REV).put("upserts", q));
        } catch (Server.AuthException e) {
            return true;                                        // a new pairing is needed; the app takes them meanwhile
        } catch (Exception e) {
            return false;
        }
        synchronized (LOCK) {
            JSONArray left = new JSONArray(), cur = queue(p);
            for (int i = 0; i < cur.length(); i++) {
                JSONObject t = cur.optJSONObject(i);
                if (t == null) continue;
                Long at = sent.get(t.optString("id"));
                if (at == null || at != t.optLong("updatedAt")) left.put(t);   // changed again while it was on its way
            }
            p.setTaskQueue(left.toString());
        }
        return true;
    }

    /** Hands the queue to the app, which applies the changes itself and syncs them with everything else. */
    static JSONArray take(Context ctx) {
        Prefs p = Prefs.of(ctx);
        synchronized (LOCK) {
            JSONArray q = queue(p);
            if (q.length() > 0) p.setTaskQueue("[]");
            return q;
        }
    }

    private static void sendSoon(Context ctx) {
        Context app = ctx.getApplicationContext();
        Pulse.BG.execute(() -> { if (!flush(app)) retryLater(app); });
    }

    private static void retryLater(Context ctx) {
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(TaskWorker.class)
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, req);
    }

    /** Replaces the queued copy of this task (only its latest state needs to go up). Call under LOCK. */
    private static void enqueue(Prefs p, JSONObject t) {
        JSONArray q = queue(p), out = new JSONArray();
        String id = t.optString("id");
        for (int i = 0; i < q.length(); i++) { JSONObject o = q.optJSONObject(i); if (o != null && !id.equals(o.optString("id"))) out.put(o); }
        out.put(t);
        p.setTaskQueue(out.toString());
    }

    /** The given todos with the queued (newer) ones laid over them. Call under LOCK. */
    private static JSONArray withQueue(Prefs p, JSONArray todos) {
        Map<String, JSONObject> byId = new HashMap<>();
        List<String> order = new ArrayList<>();
        for (int i = 0; i < todos.length(); i++) {
            JSONObject t = todos.optJSONObject(i);
            if (t == null) continue;
            if (!byId.containsKey(t.optString("id"))) order.add(t.optString("id"));
            byId.put(t.optString("id"), t);
        }
        JSONArray q = queue(p);
        for (int i = 0; i < q.length(); i++) {
            JSONObject t = q.optJSONObject(i), cur = t == null ? null : byId.get(t.optString("id"));
            if (t == null || (cur != null && cur.optLong("updatedAt") > t.optLong("updatedAt"))) continue;
            if (cur == null) order.add(t.optString("id"));
            byId.put(t.optString("id"), t);
        }
        JSONArray out = new JSONArray();
        long now = System.currentTimeMillis();
        for (String id : order) {
            JSONObject t = byId.get(id);
            // only open ones (and the undo window) are worth keeping
            if (!t.optBoolean("deleted") && (!t.optBoolean("done") || now - t.optLong("completedAt", 0) <= UNDO)) out.put(t);
        }
        return out;
    }

    private static JSONArray list(Prefs p) {
        try { return new JSONArray(p.tasks()); } catch (Exception e) { return new JSONArray(); }
    }

    private static JSONArray queue(Prefs p) {
        try { return new JSONArray(p.taskQueue()); } catch (Exception e) { return new JSONArray(); }
    }
}
