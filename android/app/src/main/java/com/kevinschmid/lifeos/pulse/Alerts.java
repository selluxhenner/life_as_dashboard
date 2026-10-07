package com.kevinschmid.lifeos.pulse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.kevinschmid.lifeos.MainActivity;
import com.kevinschmid.lifeos.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Notification channels and every notification the app posts. All are public on the lock screen: news, not secrets. */
public final class Alerts {
    static final int ID_MORNING = 4201, ID_PINNED = 4202;
    static final int SIGNAL = 0xFF4FE3FF;
    private static final String CH_BRIEFING = "briefing", CH_PINNED = "pinned";

    private Alerts() {}

    /** Channel per server kind (Settings › Notifications on the phone can then mute one kind). */
    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        channel(nm, CH_BRIEFING, "Morning briefing", "Your day, every morning at the briefing time.", NotificationManager.IMPORTANCE_HIGH);
        channel(nm, "breaking", "Breaking world news", "Major world events, reported by several outlets.", NotificationManager.IMPORTANCE_HIGH);
        channel(nm, "ai", "Major AI news", "New frontier models and big launches.", NotificationManager.IMPORTANCE_HIGH);
        channel(nm, "calendar", "Meeting prep", "A short prep note 30 minutes before a meeting.", NotificationManager.IMPORTANCE_DEFAULT);
        channel(nm, "jobs", "Job hunt", "Follow-ups that are due.", NotificationManager.IMPORTANCE_DEFAULT);
        channel(nm, "agent", "Assistant", "Approvals and call summaries.", NotificationManager.IMPORTANCE_DEFAULT);
        channel(nm, "general", "Other", "Anything else from your server.", NotificationManager.IMPORTANCE_DEFAULT);
        // Not low: many phones hide silent notifications on the lock screen, and this one is there to be seen. It has no sound instead.
        NotificationChannel pin = new NotificationChannel(CH_PINNED, "Lock-screen card", NotificationManager.IMPORTANCE_DEFAULT);
        pin.setDescription("Today at a glance, pinned to the lock screen with shortcuts.");
        pin.setSound(null, null);
        pin.enableVibration(false);
        pin.setShowBadge(false);
        pin.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(pin);
    }

    private static void channel(NotificationManager nm, String id, String name, String desc, int importance) {
        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(desc);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.enableLights(true);
        ch.setLightColor(SIGNAL);
        nm.createNotificationChannel(ch);
    }

    private static String channelFor(String kind) {
        switch (kind) {
            case "briefing": case "breaking": case "ai": case "calendar": case "jobs": case "agent": return kind;
            default: return "general";
        }
    }

    /** Opens the app at a route ("news", "home" …), optionally with an action ("listen", "ask"). */
    public static PendingIntent open(Context ctx, String route, String action, int requestCode) {
        Uri uri = Uri.parse("agenticos://open/" + route + (action == null ? "" : "?do=" + action));
        Intent i = new Intent(Intent.ACTION_VIEW, uri, ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** "#/news" → "news". */
    static String routeOf(String url) {
        String r = url == null ? "" : url.replaceFirst("^#?/?", "").replaceAll("[^\\w-].*$", "");
        return r.isEmpty() ? "home" : r;
    }

    private static NotificationCompat.Builder base(Context ctx, String channel) {
        return new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_agentic)
            .setColor(SIGNAL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
    }

    private static void show(Context ctx, int id, NotificationCompat.Builder b) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return;
        try { nm.notify(id, b.build()); } catch (SecurityException ignored) { /* permission withdrawn meanwhile */ }
    }

    /** A notification raised by the server (/api/notifications row). */
    static void post(Context ctx, JSONObject n) {
        String kind = n.optString("kind", "general"), title = n.optString("title"), body = n.optString("body");
        String route = routeOf(n.optString("url", ""));
        int id = (int) n.optLong("id");
        NotificationCompat.Builder b = base(ctx, channelFor(kind))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setWhen(n.optLong("created_at", System.currentTimeMillis()))
            .setShowWhen(true)
            .setAutoCancel(true)
            .setCategory("calendar".equals(kind) ? NotificationCompat.CATEGORY_EVENT : NotificationCompat.CATEGORY_RECOMMENDATION)
            .setContentIntent(open(ctx, route, null, id));
        if ("breaking".equals(kind) || "ai".equals(kind)) b.setGroup("news:" + kind);
        show(ctx, id, b);
    }

    static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }
    static String dayName() { return new SimpleDateFormat("EEE d MMM", Locale.ENGLISH).format(new Date()); }
    static String dayLabel() { return dayName().toUpperCase(Locale.ENGLISH); }

    /** Today's briefing from the glance, or null. */
    static JSONObject briefingToday(JSONObject g) {
        JSONObject b = g == null ? null : g.optJSONObject("briefing");
        return b != null && today().equals(b.optString("date")) ? b : null;
    }

    /** Briefing text for the notification and the tile: headline, the overview, then the spoken points. */
    static String briefingText(JSONObject b) {
        StringBuilder sb = new StringBuilder(b.optString("headline"));
        String overview = b.optString("overview");
        if (!overview.isEmpty()) sb.append("\n\n").append(overview);
        JSONArray pts = b.optJSONArray("points");
        for (int i = 0; pts != null && i < pts.length(); i++) {
            JSONObject p = pts.optJSONObject(i);
            if (p == null) continue;
            String label = p.optString("label"), say = p.optString("say");
            sb.append("\n• ").append(label.isEmpty() ? say : label + " — " + say);
        }
        return sb.toString();
    }

    static String worldLine(JSONObject g, int i) {
        JSONObject w = g == null ? null : g.optJSONObject("world");
        JSONArray top = w == null ? null : w.optJSONArray("top");
        JSONObject s = top == null ? null : top.optJSONObject(i);
        return s == null ? null : s.optString("headline", null);
    }

    /**
     * The morning notification: today's briefing when it is written, else a reminder that today's update is on the page.
     * Always the same id, so the briefing replaces the reminder quietly when it comes in later.
     * @return "briefing" or "reminder"
     */
    static String morning(Context ctx, JSONObject g, String fallbackHeadline) {
        JSONObject b = briefingToday(g);
        String title, text, big;
        if (b != null || fallbackHeadline != null) {
            title = "Your morning briefing";
            text = b != null ? b.optString("headline") : fallbackHeadline;
            big = b != null ? briefingText(b) : fallbackHeadline;
        } else {
            title = "Good morning";
            text = "Today's update is on the page.";
            String top = worldLine(g, 0);
            big = text + (top != null ? "\n\nWorld: " + top : "");
        }
        NotificationCompat.Builder nb = base(ctx, CH_BRIEFING)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText(dayName())
            .setStyle(new NotificationCompat.BigTextStyle().bigText(big))
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(open(ctx, "home", null, ID_MORNING))
            .addAction(0, "Listen", open(ctx, "home", "listen", ID_MORNING + 10))
            .addAction(0, "World", open(ctx, "news", null, ID_MORNING + 11));
        show(ctx, ID_MORNING, nb);
        return b != null || fallbackHeadline != null ? "briefing" : "reminder";
    }

    /** The optional card pinned to the lock screen: today's headline with Briefing / World / Ask. */
    static void pinned(Context ctx, JSONObject g) {
        Prefs p = Prefs.of(ctx);
        if (!p.pinned() || !p.configured()) { NotificationManagerCompat.from(ctx).cancel(ID_PINNED); return; }
        JSONObject b = briefingToday(g);
        String top = worldLine(g, 0);
        String text = b != null ? b.optString("headline") : top != null ? "World: " + top : "Tap for your day.";
        NotificationCompat.Builder nb = base(ctx, CH_PINNED)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentTitle("Today · " + dayName())
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(false)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(open(ctx, "home", null, ID_PINNED))
            .addAction(0, "Briefing", open(ctx, "home", "listen", ID_PINNED + 10))
            .addAction(0, "World", open(ctx, "news", null, ID_PINNED + 11))
            .addAction(0, "Ask", open(ctx, "home", "ask", ID_PINNED + 12));
        show(ctx, ID_PINNED, nb);
    }

    /** Settings › Send a test: how each kind looks, posted on its own channel. */
    static void test(Context ctx, String kind) {
        String title, body, url;
        switch (kind) {
            case "ai": title = "Anthropic: test alert"; body = "This is how major AI news looks: new frontier models and big launches, at most one per company in 12 hours."; url = "#/ai"; break;
            case "calendar": title = "Meeting prep · test"; body = "30 minutes before a meeting you get a short prep note like this."; url = "#/calendar"; break;
            default: kind = "breaking"; title = "Breaking · test"; body = "This is how world news alerts look. They come when several outlets report a major event."; url = "#/news";
        }
        try {
            post(ctx, new JSONObject().put("id", 4300 + kind.length()).put("kind", kind).put("title", title).put("body", body)
                .put("url", url).put("created_at", System.currentTimeMillis()));
        } catch (Exception ignored) { }
    }
}
