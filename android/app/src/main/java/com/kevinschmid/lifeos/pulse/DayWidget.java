package com.kevinschmid.lifeos.pulse;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
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
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Day-plan widget: the lesson (or meeting, or plan block) that is on now or next, with its room in a big badge and a
 * live countdown, then the rest of the day. After the last item, or from 20:00, it shows tomorrow (like Up next in the
 * app). It re-renders itself at every start and end from the cached glance, so it needs no network to stay right.
 */
public class DayWidget extends AppWidgetProvider {
    static final String TICK = "com.kevinschmid.lifeos.pulse.DAY_TICK", REFRESH = "com.kevinschmid.lifeos.pulse.DAY_REFRESH";
    // tokens.css: --amber (lessons), --signal (plan blocks), --tone-europe (calendar events), --ink-2
    private static final int AMBER = 0xFFFFC857, SIGNAL = 0xFF4FE3FF, BLUE = 0xFF85ABF0, INK2 = 0xFFA7B4C2;
    private static final long MIN = 60000, HOUR = 60 * MIN;
    private static final int EVENING = 20 * 60;          // minutes: from 20:00 the widget looks at tomorrow
    private static final int[][] ROWS = {
        { R.id.d_row1, R.id.d_row1_time, R.id.d_row1_title, R.id.d_row1_room },
        { R.id.d_row2, R.id.d_row2_time, R.id.d_row2_title, R.id.d_row2_room },
        { R.id.d_row3, R.id.d_row3_time, R.id.d_row3_title, R.id.d_row3_room },
        { R.id.d_row4, R.id.d_row4_time, R.id.d_row4_title, R.id.d_row4_room }
    };

    static final class Item { String kind, tag, title, detail, room; long start, end; }

    /** What to show: today's items still to come, or tomorrow's; the first is the hero. */
    static final class Plan {
        boolean tomorrow, running;
        String date;
        List<Item> items = new ArrayList<>();
        int lessons;
        Item firstTomorrow;           // on the today view: where the next day starts
    }

    /* ---------- the plan at a given moment ---------- */

    private static List<Item> items(JSONObject day) {
        List<Item> out = new ArrayList<>();
        JSONArray a = day == null ? null : day.optJSONArray("items");
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || o.optBoolean("allDay") || o.optLong("start", 0) == 0) continue;
            Item it = new Item();
            it.kind = o.optString("kind", "event");
            it.tag = o.optString("tag", "");
            it.title = o.optString("title", "");
            it.detail = o.optString("detail", "");
            it.room = o.optString("room", "");
            it.start = o.optLong("start");
            it.end = Math.max(o.optLong("end", it.start + HOUR), it.start);
            out.add(it);
        }
        return out;
    }

    static Plan plan(JSONObject g, long now) {
        JSONObject d = g == null ? null : g.optJSONObject("day");
        String today = Alerts.today();
        JSONObject t = null, tm = null;
        if (d != null) {
            JSONObject a = d.optJSONObject("today"), b = d.optJSONObject("tomorrow");
            if (a != null && today.equals(a.optString("date"))) { t = a; tm = b; }
            else if (b != null && today.equals(b.optString("date"))) t = b;          // cached yesterday: its "tomorrow" is today
        }
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        int nowMin = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        Plan p = new Plan();
        for (Item i : items(t)) if (i.end > now) p.items.add(i);
        p.date = today;
        List<Item> next = items(tm);
        if (p.items.isEmpty() || nowMin >= EVENING) {
            p.tomorrow = true;
            p.items = next;
            p.date = tm == null ? null : tm.optString("date", null);
        } else if (!next.isEmpty()) p.firstTomorrow = next.get(0);
        p.running = !p.tomorrow && !p.items.isEmpty() && p.items.get(0).start <= now;
        for (Item i : p.items) if ("lesson".equals(i.kind)) p.lessons++;
        return p;
    }

    /* ---------- rendering ---------- */

    private static String hm(long t) { return new SimpleDateFormat("HH:mm", Locale.ENGLISH).format(new Date(t)); }

    private static String dayLabel(String date) {
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(date);
            return new SimpleDateFormat("EEE d MMM", Locale.ENGLISH).format(d).toUpperCase(Locale.ENGLISH);
        } catch (Exception e) { return ""; }
    }

    private static int toneOf(Item i) { return "lesson".equals(i.kind) ? AMBER : "plan".equals(i.kind) ? SIGNAL : BLUE; }

    private static RemoteViews build(Context ctx, boolean full, long now) {
        Prefs p = Prefs.of(ctx);
        JSONObject g = p.glance();
        Plan plan = plan(g, now);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), full ? R.layout.widget_day : R.layout.widget_day_small);
        v.setOnClickPendingIntent(R.id.d_root, Alerts.open(ctx, "today", null, 5300));

        if (full) {
            v.setTextViewText(R.id.d_head, plan.tomorrow ? "TOMORROW" + (plan.date == null ? "" : " · " + dayLabel(plan.date)) : "TODAY · " + Alerts.dayLabel());
            v.setTextViewText(R.id.d_count, plan.lessons == 0 ? "" : plan.lessons + (plan.lessons == 1 ? " LESSON" : " LESSONS") + (plan.tomorrow ? "" : " LEFT"));
            Intent refresh = new Intent(ctx, DayWidget.class).setAction(REFRESH);
            v.setOnClickPendingIntent(R.id.d_refresh, PendingIntent.getBroadcast(ctx, 5301, refresh, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }

        if (plan.items.isEmpty()) {
            String msg = !p.configured() ? "Open Agentic OS once to connect it."
                : g == null || g.optJSONObject("day") == null ? "Your plan appears after the next sync."
                : "Nothing on the clock today or tomorrow.";
            v.setChronometer(R.id.d_countdown, SystemClock.elapsedRealtime(), null, false);
            v.setViewVisibility(R.id.d_countdown, View.GONE);
            v.setViewVisibility(R.id.d_room_box, View.GONE);
            if (full) {
                v.setViewVisibility(R.id.d_hero, View.GONE);
                v.setViewVisibility(R.id.d_rows, View.GONE);
                v.setViewVisibility(R.id.d_next_day, View.GONE);
                v.setViewVisibility(R.id.d_empty, View.VISIBLE);
                v.setTextViewText(R.id.d_empty, msg);
            } else {
                v.setTextViewText(R.id.d_state, plan.tomorrow ? "TOMORROW" : "TODAY");
                v.setTextColor(R.id.d_state, SIGNAL);
                v.setTextViewText(R.id.d_title, msg);
                v.setTextViewText(R.id.d_detail, "");
            }
            return v;
        }

        Item h = plan.items.get(0);
        boolean lesson = "lesson".equals(h.kind);
        int tone = toneOf(h);
        String tag = h.tag.isEmpty() || "LU".equalsIgnoreCase(h.tag) ? "" : h.tag.toUpperCase(Locale.ENGLISH) + " · ";
        boolean countdown = !plan.running && !plan.tomorrow && h.start - now <= 3 * HOUR;
        String state = plan.running ? "NOW · " + tag + "UNTIL " + hm(h.end)
            : plan.tomorrow ? "FIRST · " + tag + hm(h.start)
            : countdown ? "NEXT · " + tag.replaceAll(" · $", "")
            : "NEXT · " + tag + hm(h.start);
        v.setTextViewText(R.id.d_state, state.replaceAll(" · $", ""));
        v.setTextColor(R.id.d_state, tone);
        if (countdown) {
            v.setChronometer(R.id.d_countdown, SystemClock.elapsedRealtime() + (h.start - now), "in %s", true);
            v.setChronometerCountDown(R.id.d_countdown, true);
            v.setViewVisibility(R.id.d_countdown, View.VISIBLE);
        } else {
            v.setChronometer(R.id.d_countdown, SystemClock.elapsedRealtime(), null, false);
            v.setViewVisibility(R.id.d_countdown, View.GONE);
        }
        v.setTextViewText(R.id.d_title, h.title);
        String times = hm(h.start) + " – " + hm(h.end);
        v.setTextViewText(R.id.d_detail, full && !h.detail.isEmpty() ? times + " · " + h.detail : times);

        if (h.room.isEmpty()) v.setViewVisibility(R.id.d_room_box, View.GONE);
        else {
            v.setViewVisibility(R.id.d_room_box, View.VISIBLE);
            v.setInt(R.id.d_room_box, "setBackgroundResource", lesson ? R.drawable.day_room_bg : R.drawable.day_room_event_bg);
            v.setTextViewText(R.id.d_room_label, lesson ? "ROOM" : "WHERE");
            v.setTextColor(R.id.d_room_label, (tone & 0x00FFFFFF) | 0xB3000000);
            v.setTextViewText(R.id.d_room, h.room.toUpperCase(Locale.ENGLISH));
            v.setTextColor(R.id.d_room, tone);
        }
        if (!full) return v;

        v.setViewVisibility(R.id.d_hero, View.VISIBLE);
        v.setInt(R.id.d_hero, "setBackgroundResource", lesson ? R.drawable.day_hero_lesson_bg : R.drawable.day_hero_bg);
        v.setViewVisibility(R.id.d_empty, View.GONE);
        List<Item> rest = plan.items.subList(1, plan.items.size());
        v.setViewVisibility(R.id.d_rows, rest.isEmpty() ? View.GONE : View.VISIBLE);
        for (int r = 0; r < ROWS.length; r++) {
            int[] ids = ROWS[r];
            boolean more = r == ROWS.length - 1 && rest.size() > ROWS.length;
            if (r >= rest.size()) { v.setViewVisibility(ids[0], View.GONE); continue; }
            v.setViewVisibility(ids[0], View.VISIBLE);
            if (more) {
                v.setTextViewText(ids[1], "");
                v.setTextViewText(ids[2], "+" + (rest.size() - r) + " more");
                v.setTextColor(ids[2], INK2);
                v.setTextViewText(ids[3], "");
                continue;
            }
            Item it = rest.get(r);
            SpannableStringBuilder title = new SpannableStringBuilder("● ");
            title.setSpan(new ForegroundColorSpan(toneOf(it)), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            title.append(it.title);
            v.setTextViewText(ids[1], hm(it.start));
            v.setTextViewText(ids[2], title);
            v.setTextColor(ids[2], 0xFFE6EDF3);
            v.setTextViewText(ids[3], it.room.toUpperCase(Locale.ENGLISH));
            v.setTextColor(ids[3], toneOf(it));
        }

        Item t = plan.firstTomorrow;
        v.setViewVisibility(R.id.d_next_day, t == null ? View.GONE : View.VISIBLE);
        if (t != null) {
            v.setTextViewText(R.id.d_next_label, "TOMORROW " + hm(t.start));
            v.setTextViewText(R.id.d_next_title, t.title);
            v.setTextViewText(R.id.d_next_room, t.room.toUpperCase(Locale.ENGLISH));
            v.setTextColor(R.id.d_next_room, toneOf(t));
        }
        return v;
    }

    /** Android 12+ picks the layout by size itself; older launchers tell us the height. */
    private static RemoteViews views(Context ctx, Bundle opts, long now) {
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> m = new HashMap<>();
            m.put(new SizeF(150f, 40f), build(ctx, false, now));
            m.put(new SizeF(220f, 150f), build(ctx, true, now));
            return new RemoteViews(m);
        }
        int minH = opts == null ? 200 : opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 200);
        return build(ctx, minH >= 150, now);
    }

    /* ---------- lifecycle ---------- */

    static int count(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, DayWidget.class)).length;
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        long now = System.currentTimeMillis();
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, DayWidget.class))) mgr.updateAppWidget(id, views(ctx, mgr.getAppWidgetOptions(id), now));
        scheduleTick(ctx, now);
    }

    /** Re-render at the next start or end, at 20:00 and at midnight. Not a wakeup alarm: it lands when the screen is on. */
    private static void scheduleTick(Context ctx, long now) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 5310, new Intent(ctx, DayWidget.class).setAction(TICK),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (count(ctx) == 0) { am.cancel(pi); return; }
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.HOUR_OF_DAY, EVENING / 60);
        long next = c.getTimeInMillis() > now ? c.getTimeInMillis() : Long.MAX_VALUE;
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.add(Calendar.DAY_OF_YEAR, 1);
        next = Math.min(next, c.getTimeInMillis());
        JSONObject d = Prefs.of(ctx).glance() == null ? null : Prefs.of(ctx).glance().optJSONObject("day");
        if (d != null) for (String k : new String[] { "today", "tomorrow" })
            for (Item i : items(d.optJSONObject(k))) {
                if (i.start > now) next = Math.min(next, i.start);
                if (i.end > now) next = Math.min(next, i.end);
            }
        am.setWindow(AlarmManager.RTC, next + 2000, MIN, pi);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        long now = System.currentTimeMillis();
        for (int id : ids) mgr.updateAppWidget(id, views(ctx, mgr.getAppWidgetOptions(id), now));
        scheduleTick(ctx, now);
        Prefs p = Prefs.of(ctx);
        if (p.configured() && (now - p.glanceAt() > 30 * MIN || p.glance() == null || p.glance().optJSONObject("day") == null)) refreshAsync(ctx, null);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        mgr.updateAppWidget(id, views(ctx, options, System.currentTimeMillis()));
    }

    @Override
    public void onDisabled(Context ctx) { scheduleTick(ctx, System.currentTimeMillis()); }   // no widgets left: cancels the tick

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (TICK.equals(a)) updateAll(ctx);
        else if (REFRESH.equals(a)) refreshAsync(ctx, goAsync());
        else super.onReceive(ctx, intent);
    }

    private static void refreshAsync(Context ctx, PendingResult result) {
        Context app = ctx.getApplicationContext();
        Pulse.BG.execute(() -> {
            try { Pulse.check(app, true); updateAll(app); } finally { if (result != null) result.finish(); }
        });
    }
}
