package com.kevinschmid.lifeos.pulse;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import com.kevinschmid.lifeos.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Home-screen (and, where the phone allows it, lock-screen) widget: briefing headline, world top stories, top AI news. */
public class GlanceWidget extends AppWidgetProvider {
    static final String REFRESH = "com.kevinschmid.lifeos.pulse.REFRESH";
    // Continent tones from src/styles/tokens.css (oklch → sRGB)
    private static final Map<String, Integer> TONE = new HashMap<>();
    static {
        TONE.put("europe", 0xFF85ABF0); TONE.put("africa", 0xFFE79F5C); TONE.put("asia", 0xFFEA808F); TONE.put("mideast", 0xFFD5BC70);
        TONE.put("namerica", 0xFF63CCC0); TONE.put("samerica", 0xFF97D083); TONE.put("oceania", 0xFFB59BE6);
    }
    private static final int FLARE = 0xFFFF4D5E, SIGNAL = 0xFF4FE3FF;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, views(ctx, mgr.getAppWidgetOptions(id)));
        if (Prefs.of(ctx).configured() && System.currentTimeMillis() - Prefs.of(ctx).glanceAt() > 30 * 60000) refreshAsync(ctx, null);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        mgr.updateAppWidget(id, views(ctx, options));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (REFRESH.equals(intent.getAction())) refreshAsync(ctx, goAsync());
        else super.onReceive(ctx, intent);
    }

    private static void refreshAsync(Context ctx, PendingResult result) {
        Context app = ctx.getApplicationContext();
        Pulse.BG.execute(() -> {
            try { Pulse.check(app, true); updateAll(app); } finally { if (result != null) result.finish(); }
        });
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, GlanceWidget.class))) mgr.updateAppWidget(id, views(ctx, mgr.getAppWidgetOptions(id)));
    }

    static int count(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, GlanceWidget.class)).length;
    }

    /** Android 12+ picks the layout by size itself; older launchers tell us the height. */
    private static RemoteViews views(Context ctx, Bundle opts) {
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> m = new HashMap<>();
            m.put(new SizeF(150f, 50f), build(ctx, false));
            m.put(new SizeF(240f, 170f), build(ctx, true));
            return new RemoteViews(m);
        }
        int minH = opts == null ? 200 : opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 200);
        return build(ctx, minH >= 170);
    }

    private static RemoteViews build(Context ctx, boolean full) {
        Prefs p = Prefs.of(ctx);
        JSONObject g = p.glance();
        JSONObject b = Alerts.briefingToday(g);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), full ? R.layout.widget_glance : R.layout.widget_glance_small);

        v.setTextViewText(R.id.w_date, Alerts.dayLabel() + (full ? " · BRIEFING" : ""));
        String headline = !p.configured() ? "Open Agentic OS once to connect it."
            : b != null ? b.optString("headline")
            : "Your briefing arrives at " + p.briefingTime() + ".";
        v.setTextViewText(R.id.w_headline, headline);
        v.setOnClickPendingIntent(R.id.w_root, Alerts.open(ctx, "home", null, 5100));

        JSONObject world = g == null ? null : g.optJSONObject("world");
        JSONArray top = world == null ? null : world.optJSONArray("top");
        JSONArray breaking = world == null ? null : world.optJSONArray("breaking");
        // breaking first (red), then the digest's top stories (continent tone)
        CharSequence[] lines = new CharSequence[3];
        int n = 0;
        for (int i = 0; breaking != null && i < breaking.length() && n < 1; i++) lines[n++] = line(breaking.optJSONObject(i), FLARE, "BREAKING ");
        for (int i = 0; top != null && i < top.length() && n < 3; i++) {
            JSONObject s = top.optJSONObject(i);
            Integer tone = s == null ? null : TONE.get(s.optString("region"));
            lines[n++] = line(s, tone == null ? SIGNAL : tone, null);
        }

        if (!full) {
            v.setTextViewText(R.id.w_world1, lines[0] == null ? "" : lines[0]);
            return v;
        }
        String overview = b == null ? "" : b.optString("overview");
        v.setTextViewText(R.id.w_overview, overview);
        v.setViewVisibility(R.id.w_overview, overview.isEmpty() ? View.GONE : View.VISIBLE);
        int[] ids = { R.id.w_world1, R.id.w_world2, R.id.w_world3 };
        for (int i = 0; i < 3; i++) {
            v.setTextViewText(ids[i], lines[i] == null ? "" : lines[i]);
            v.setViewVisibility(ids[i], lines[i] == null ? View.GONE : View.VISIBLE);
        }
        if (n == 0) { v.setTextViewText(R.id.w_world1, "The world digest comes at 07:00, 13:00 and 19:00."); v.setViewVisibility(R.id.w_world1, View.VISIBLE); }

        JSONObject ai = g == null ? null : g.optJSONObject("ai");
        JSONArray aiTop = ai == null ? null : ai.optJSONArray("top");
        JSONObject first = aiTop == null ? null : aiTop.optJSONObject(0);
        v.setViewVisibility(R.id.w_ai, first == null ? View.GONE : View.VISIBLE);
        if (first != null) v.setTextViewText(R.id.w_ai1, first.optString("vendor") + " · " + first.optString("title"));

        long at = p.glanceAt();
        v.setTextViewText(R.id.w_updated, at == 0 ? "" : "Updated " + new SimpleDateFormat("HH:mm", Locale.ENGLISH).format(new Date(at)));
        v.setOnClickPendingIntent(R.id.w_brief, Alerts.open(ctx, "home", null, 5100));
        v.setOnClickPendingIntent(R.id.w_world, Alerts.open(ctx, "news", null, 5101));
        v.setOnClickPendingIntent(R.id.w_ai, Alerts.open(ctx, "ai", null, 5102));
        Intent refresh = new Intent(ctx, GlanceWidget.class).setAction(REFRESH);
        v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 5103, refresh, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return v;
    }

    /** "● Headline" with the dot in the story's colour. */
    private static CharSequence line(JSONObject s, int color, String prefix) {
        if (s == null) return null;
        SpannableStringBuilder sb = new SpannableStringBuilder("● ");
        sb.setSpan(new ForegroundColorSpan(color), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (prefix != null) {
            int start = sb.length();
            sb.append(prefix);
            sb.setSpan(new ForegroundColorSpan(color), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        sb.append(s.optString("headline"));
        return sb;
    }
}
