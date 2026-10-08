package com.kevinschmid.lifeos.pulse;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.TileService;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The phone's side of alerts, without the WebView:
 *  - every 15 minutes (WorkManager) it fetches new notifications from the server and posts them on their channel;
 *  - an exact alarm at the briefing time shows the briefing, or a reminder that today's update is on the page;
 *  - with Firebase set up, the server can wake it instantly (see PushService);
 *  - each check refreshes the glance behind the widget, the Quick Settings tile and the lock-screen card.
 */
public final class Pulse {
    static final ExecutorService BG = Executors.newSingleThreadExecutor();
    private static final String WORK = "agentic-pulse";
    private static final long MIN = 60000, HOUR = 60 * MIN;

    private Pulse() {}

    /** Background checks + the morning alarm. Safe to call often. */
    public static void schedule(Context ctx) {
        if (!Prefs.of(ctx).configured()) { cancel(ctx); return; }
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(PulseWorker.class, 15, TimeUnit.MINUTES).setConstraints(online).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req);
        scheduleMorning(ctx);
    }

    public static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK);
        ctx.getSystemService(AlarmManager.class).cancel(morningIntent(ctx));
        Prefs.of(ctx).setNextMorningAt(0);
        Alerts.pinned(ctx, null);
    }

    private static PendingIntent morningIntent(Context ctx) {
        Intent i = new Intent(ctx, MorningReceiver.class).setAction(MorningReceiver.ACTION);
        return PendingIntent.getBroadcast(ctx, 7, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Next briefing time today or tomorrow. Exact even in Doze; inexact (a few minutes late) if exact alarms are not allowed. */
    static void scheduleMorning(Context ctx) {
        Prefs p = Prefs.of(ctx);
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (!p.configured()) { am.cancel(morningIntent(ctx)); return; }
        String[] hm = p.briefingTime().split(":");
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hm[0]));
        c.set(Calendar.MINUTE, Integer.parseInt(hm[1]));
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis() + 5000) c.add(Calendar.DAY_OF_YEAR, 1);
        long at = c.getTimeInMillis();
        if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, morningIntent(ctx));
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, morningIntent(ctx));
        p.setNextMorningAt(at);
    }

    static boolean canExact(Context ctx) {
        return Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    /**
     * Fetches new notifications and posts them; refreshes the glance when asked, when a briefing came in, or when it is
     * older than 10 minutes. The first check after pairing only takes the cursor, so no backlog floods the phone.
     * @return an error message, or null when everything worked
     */
    static synchronized String check(Context ctx, boolean forceGlance) {
        Prefs p = Prefs.of(ctx);
        if (!p.configured()) return "Not connected to a server yet.";
        Captures.flush(ctx);                                                  // widget captures that missed the network
        String error = null;
        JSONObject briefingNote = null;
        long now = System.currentTimeMillis();
        try {
            JSONArray list = Server.get(p, "/api/notifications?since=" + p.lastId()).optJSONArray("notifications");
            long max = p.lastId();
            boolean primed = p.primed();
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject n = list.getJSONObject(i);
                long id = n.optLong("id");
                if (id <= p.lastId()) continue;
                max = Math.max(max, id);
                long age = now - n.optLong("created_at", now);
                if (age > (primed ? 12 * HOUR : 30 * MIN)) continue;          // stale (phone was off) or backlog
                if ("briefing".equals(n.optString("kind"))) briefingNote = n;  // shown as the rich morning notification below
                else Alerts.post(ctx, n);
            }
            p.setCursor(max);
        } catch (Exception e) { error = message(e); }
        if (error == null && (forceGlance || briefingNote != null || now - p.glanceAt() > 10 * MIN)) {
            try { applyGlance(ctx, Server.get(p, "/api/glance")); } catch (Exception e) { error = message(e); }
        }
        if (briefingNote != null) showMorning(ctx, p.glance(), briefingNote.optString("body", null));
        p.checked(error);
        return error;
    }

    private static String message(Exception e) {
        return e instanceof Server.AuthException ? e.getMessage() : "Server unreachable (" + e.getClass().getSimpleName() + ": " + e.getMessage() + ")";
    }

    static void applyGlance(Context ctx, JSONObject g) {
        Prefs p = Prefs.of(ctx);
        p.setGlance(g);
        String hm = g.optString("briefingTime", "");
        if (hm.matches("\\d{2}:\\d{2}") && !hm.equals(p.briefingTime())) { p.setBriefingTime(hm); scheduleMorning(ctx); }
        refreshSurfaces(ctx);
    }

    /** Widgets, tile and lock-screen card from the cached glance. */
    static void refreshSurfaces(Context ctx) {
        GlanceWidget.updateAll(ctx);
        DayWidget.updateAll(ctx);
        Alerts.pinned(ctx, Prefs.of(ctx).glance());
        try { TileService.requestListeningState(ctx, new ComponentName(ctx, BriefingTile.class)); } catch (Exception ignored) { }
    }

    static void showMorning(Context ctx, JSONObject g, String fallbackHeadline) {
        if (g != null && !g.optBoolean("morning", true)) return;          // switched off in Settings › Notifications
        Prefs.of(ctx).setMorning(Alerts.today(), Alerts.morning(ctx, g, fallbackHeadline));
    }

    /** The alarm at the briefing time: the briefing when it is there, else the reminder. Never twice a day. */
    static void morningAlarm(Context ctx) {
        scheduleMorning(ctx);                                                  // tomorrow's first, whatever happens next
        Prefs p = Prefs.of(ctx);
        if (!p.configured() || done(p)) return;
        check(ctx, true);
        if (done(p)) return;
        JSONObject g = p.glance();
        // offline: the cached glance is yesterday's, so this becomes the plain reminder
        showMorning(ctx, g, null);
    }

    private static boolean done(Prefs p) { return Alerts.today().equals(p.morningDate()) && "briefing".equals(p.morningKind()); }

    /* ---------- optional instant push (Firebase) ---------- */

    static boolean firebase(Context ctx) {
        try { return !FirebaseApp.getApps(ctx).isEmpty(); } catch (Throwable t) { return false; }
    }

    /** Registers this phone's Firebase token with the server, when the app was built with google-services.json. */
    static void registerPush(Context ctx) {
        if (!firebase(ctx) || !Prefs.of(ctx).configured()) return;
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> BG.execute(() -> sendPushToken(ctx, token)));
    }

    static void sendPushToken(Context ctx, String token) {
        Prefs p = Prefs.of(ctx);
        if (!p.configured() || token == null || token.equals(p.pushSent())) return;
        try {
            Server.post(p, "/api/push/register", new JSONObject().put("token", token));
            p.setPushSent(token);
        } catch (Exception ignored) { /* next start tries again */ }
    }
}
