package com.kevinschmid.lifeos.pulse;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import com.kevinschmid.lifeos.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Tasks widget: two task groups side by side (School | Business, …), most urgent first, from the tasks part of the
 * cached glance. The circle ticks a task off (offline the tick waits in a queue, like widget captures), the title opens
 * Today, and a tap on a column's name switches that column to the next group (never the one the other column shows).
 */
public class TasksWidget extends AppWidgetProvider {
    static final String REFRESH = "com.kevinschmid.lifeos.pulse.TASKS_REFRESH", DONE = "com.kevinschmid.lifeos.pulse.TASKS_DONE",
        CYCLE = "com.kevinschmid.lifeos.pulse.TASKS_CYCLE";
    static final String ALL = "*";
    // tokens.css: --ink, --ink-2, --ink-3, --signal, --flare (high priority, overdue), --amber (medium priority, due today)
    private static final int INK = 0xFFE6EDF3, INK2 = 0xFFA7B4C2, INK3 = 0xFF6B7A8C, SIGNAL = 0xFF4FE3FF, FLARE = 0xFFFF4D5E, AMBER = 0xFFFFC857;
    private static final int[] HEIGHTS = { 90, 140, 190, 240, 300 };      // dp: Android 12+ picks the largest that fits
    private static final int[][] COLS = {
        { R.id.t_left_head, R.id.t_left_name, R.id.t_left_count, R.id.t_left_rows },
        { R.id.t_right_head, R.id.t_right_name, R.id.t_right_count, R.id.t_right_rows }
    };
    private static final Object LOCK = new Object();

    /** What a column can show: one group, or every open task. */
    static final class Choice { String id, name; int color, open; }

    static final class Item { String id, title, group, priority, due; boolean overdue; }

    /* ---------- the data ---------- */

    /** The groups as the server last sent them, then "All tasks". Before the first glance (or from an old server): the defaults. */
    static List<Choice> choices(JSONObject g) {
        JSONObject t = g == null ? null : g.optJSONObject("tasks");
        JSONArray a = t == null ? null : t.optJSONArray("groups");
        if (a == null) {
            try { a = new JSONArray("[{\"id\":\"private\",\"name\":\"Private\",\"color\":\"samerica\"},{\"id\":\"school\",\"name\":\"School\",\"color\":\"africa\"},"
                + "{\"id\":\"business\",\"name\":\"Business\",\"color\":\"europe\"}]"); } catch (Exception e) { a = new JSONArray(); }
        }
        List<Choice> out = new ArrayList<>();
        int all = t == null ? 0 : t.optInt("ungrouped");
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || o.optString("id").isEmpty()) continue;
            Choice c = new Choice();
            c.id = o.optString("id");
            c.name = o.optString("name", c.id);
            Integer tone = GlanceWidget.TONE.get(o.optString("color"));
            c.color = tone == null ? INK3 : tone;
            c.open = o.optInt("open");
            all += c.open;
            out.add(c);
        }
        Choice c = new Choice();
        c.id = ALL; c.name = "All tasks"; c.color = SIGNAL; c.open = all;
        out.add(c);
        return out;
    }

    static Choice find(List<Choice> choices, String id) {
        for (Choice c : choices) if (c.id.equals(id)) return c;
        return null;
    }

    /** The widget's two columns: what was picked for it, else the first two groups (also when a picked group was deleted). */
    static String[] chosen(Context ctx, int widgetId, List<Choice> choices) {
        String[] cols = Prefs.of(ctx).tasksColumns(widgetId);
        for (int s = 0; s < 2; s++) if (find(choices, cols[s]) == null) cols[s] = null;
        for (Choice c : choices) {
            if (cols[0] == null && !c.id.equals(cols[1])) cols[0] = c.id;
            else if (cols[1] == null && !c.id.equals(cols[0])) cols[1] = c.id;
        }
        if (cols[1] == null) cols[1] = cols[0];
        return cols;
    }

    private static List<Item> items(JSONObject g) {
        List<Item> out = new ArrayList<>();
        JSONObject t = g == null ? null : g.optJSONObject("tasks");
        JSONArray a = t == null ? null : t.optJSONArray("items");
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            Item it = new Item();
            it.id = o.optString("id");
            it.title = o.optString("title");
            it.group = o.optString("group", "");
            it.priority = o.optString("priority", "med");
            it.due = o.isNull("due") ? "" : o.optString("due", "");
            it.overdue = o.optBoolean("overdue");
            out.add(it);
        }
        return out;
    }

    /* ---------- ticking tasks off ---------- */

    private static Set<String> queued(Prefs p) {
        Set<String> out = new LinkedHashSet<>();
        try { JSONArray a = new JSONArray(p.tasksDone()); for (int i = 0; i < a.length(); i++) out.add(a.getString(i)); } catch (Exception ignored) { }
        return out;
    }

    private static void tick(Context ctx, String id, String title) {
        if (id == null || id.isEmpty()) return;
        Prefs p = Prefs.of(ctx);
        synchronized (LOCK) {
            Set<String> q = queued(p);
            q.add(id);
            p.setTasksDone(new JSONArray(q).toString());
        }
        updateAll(ctx);                                                           // gone from the list right away
        Toast.makeText(ctx, "Done: " + (title == null ? "task" : title), Toast.LENGTH_SHORT).show();
    }

    /** Sends the waiting ticks (Pulse.check calls this first). Each one the server took, or no longer knows, leaves the
        queue and the cached glance, so the task does not flash back before the next glance arrives. */
    static void flush(Context ctx) {
        Prefs p = Prefs.of(ctx);
        if (!p.configured()) return;
        for (String id : queued(p)) {
            try { Server.post(p, "/api/todos/" + Uri.encode(id), new JSONObject().put("done", true)); }
            catch (Server.HttpError e) { if (e.code >= 500 || e.code == 429) continue; }   // anything else will never work: drop it
            catch (Exception e) { continue; }                                            // offline or a bad token: next check
            synchronized (LOCK) {
                Set<String> q = queued(p);
                q.remove(id);
                p.setTasksDone(new JSONArray(q).toString());
                dropFromGlance(p, id);
            }
        }
    }

    private static void dropFromGlance(Prefs p, String id) {
        JSONObject g = p.glance();
        JSONObject t = g == null ? null : g.optJSONObject("tasks");
        JSONArray a = t == null ? null : t.optJSONArray("items");
        if (a == null) return;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || !id.equals(o.optString("id"))) continue;
            a.remove(i);
            String group = o.optString("group", "");
            JSONArray groups = t.optJSONArray("groups");
            try {
                if (group.isEmpty()) t.put("ungrouped", Math.max(0, t.optInt("ungrouped") - 1));
                for (int k = 0; groups != null && k < groups.length(); k++) {
                    JSONObject gr = groups.optJSONObject(k);
                    if (gr != null && group.equals(gr.optString("id"))) gr.put("open", Math.max(0, gr.optInt("open") - 1));
                }
            } catch (Exception ignored) { }
            p.updateGlance(g);
            return;
        }
    }

    /** Next group in that column, skipping the one the other column shows. */
    private static void cycle(Context ctx, int widgetId, int side) {
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || side < 0 || side > 1) return;
        List<Choice> choices = choices(Prefs.of(ctx).glance());
        String[] cols = chosen(ctx, widgetId, choices);
        int at = choices.indexOf(find(choices, cols[side]));
        for (int k = 1; k <= choices.size(); k++) {
            Choice c = choices.get((at + k) % choices.size());
            if (!c.id.equals(cols[1 - side]) || choices.size() < 2) { cols[side] = c.id; break; }
        }
        Prefs.of(ctx).setTasksColumns(widgetId, cols[0], cols[1]);
        update(ctx, widgetId);
    }

    /* ---------- rendering ---------- */

    private static int rowsFor(int heightDp) { return Math.max(1, Math.min(8, (heightDp - 70) / 26)); }

    private static String due(String date, boolean overdue) {
        if (date == null || date.isEmpty()) return "";
        try {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Date d = iso.parse(date);
            String today = Alerts.today();
            Calendar c = Calendar.getInstance();
            c.add(Calendar.DAY_OF_YEAR, 1);
            if (date.equals(today)) return "TODAY";
            if (date.equals(iso.format(c.getTime()))) return "TMRW";
            c.add(Calendar.DAY_OF_YEAR, 5);
            boolean thisWeek = !overdue && date.compareTo(iso.format(c.getTime())) <= 0;
            return new SimpleDateFormat(thisWeek ? "EEE" : "d MMM", Locale.ENGLISH).format(d).toUpperCase(Locale.ENGLISH);
        } catch (Exception e) { return ""; }
    }

    private static int prioColor(String p) { return "high".equals(p) ? FLARE : "low".equals(p) ? INK3 : AMBER; }

    private static PendingIntent broadcast(Context ctx, String action, Uri data, int code, Intent extras) {
        Intent i = new Intent(ctx, TasksWidget.class).setAction(action).setData(data);
        if (extras != null) i.putExtras(extras);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews build(Context ctx, int widgetId, int rows) {
        Prefs p = Prefs.of(ctx);
        JSONObject g = p.glance();
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_groups);
        v.setTextViewText(R.id.t_head, "TASKS · " + Alerts.dayLabel());
        v.setOnClickPendingIntent(R.id.t_head, Alerts.open(ctx, "today", null, 5400));
        v.setOnClickPendingIntent(R.id.t_refresh, broadcast(ctx, REFRESH, null, 5401, null));

        String msg = !p.configured() ? "Open Agentic OS once to connect it."
            : g == null ? "Your tasks appear after the next sync."
            : g.optJSONObject("tasks") == null ? "Update the server to see your tasks here." : null;
        v.setViewVisibility(R.id.t_msg, msg == null ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.t_cols, msg == null ? View.VISIBLE : View.GONE);
        if (msg != null) { v.setTextViewText(R.id.t_msg, msg); return v; }

        Set<String> done = queued(p);
        List<Choice> choices = choices(g);
        String[] cols = chosen(ctx, widgetId, choices);
        List<Item> all = items(g);
        for (int s = 0; s < 2; s++) column(ctx, v, widgetId, s, find(choices, cols[s]), all, done, rows);
        return v;
    }

    private static void column(Context ctx, RemoteViews v, int widgetId, int side, Choice c, List<Item> all, Set<String> done, int rows) {
        int[] ids = COLS[side];
        List<Item> list = new ArrayList<>();
        int ticked = 0;
        for (Item i : all) {
            if (!ALL.equals(c.id) && !c.id.equals(i.group)) continue;
            if (done.contains(i.id)) ticked++; else list.add(i);
        }
        int open = Math.max(list.size(), c.open - ticked);

        SpannableStringBuilder name = new SpannableStringBuilder("● ");
        name.setSpan(new ForegroundColorSpan(c.color), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        name.append(c.name.toUpperCase(Locale.ENGLISH));
        v.setTextViewText(ids[1], name);
        v.setTextViewText(ids[2], String.valueOf(open));
        v.setOnClickPendingIntent(ids[0], broadcast(ctx, CYCLE, Uri.parse("agenticos-tasks://cycle/" + widgetId + "/" + side), 5402,
            intentExtras(widgetId, side)));

        v.removeAllViews(ids[3]);
        String pkg = ctx.getPackageName();
        int shown = open > rows ? rows - 1 : Math.min(rows, list.size());
        for (int r = 0; r < shown && r < list.size(); r++) {
            Item it = list.get(r);
            RemoteViews row = new RemoteViews(pkg, R.layout.widget_group_row);
            row.setTextViewText(R.id.tr_check, "○");
            row.setTextColor(R.id.tr_check, prioColor(it.priority));
            row.setTextViewText(R.id.tr_title, it.title);
            row.setTextColor(R.id.tr_title, INK);
            String d = due(it.due, it.overdue);
            row.setTextViewText(R.id.tr_due, d);
            row.setTextColor(R.id.tr_due, it.overdue ? FLARE : "TODAY".equals(d) ? AMBER : INK3);
            row.setViewVisibility(R.id.tr_due, d.isEmpty() ? View.GONE : View.VISIBLE);
            Bundle x = new Bundle();
            x.putString("id", it.id);
            x.putString("title", it.title);
            Intent extras = new Intent().putExtras(x);
            row.setOnClickPendingIntent(R.id.tr_check, broadcast(ctx, DONE, Uri.parse("agenticos-tasks://done/" + Uri.encode(it.id)), 5403, extras));
            row.setContentDescription(R.id.tr_check, "Complete " + it.title);
            row.setOnClickPendingIntent(R.id.tr_title, Alerts.open(ctx, "today", null, 5400));
            v.addView(ids[3], row);
        }
        if (open > shown) {
            RemoteViews more = note(pkg, "+" + (open - shown) + " more", INK2);
            more.setOnClickPendingIntent(R.id.tr_title, Alerts.open(ctx, "today", null, 5400));
            v.addView(ids[3], more);
        }
        if (open == 0) v.addView(ids[3], note(pkg, "Nothing open.", INK3));
    }

    private static Intent intentExtras(int widgetId, int side) {
        return new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).putExtra("side", side);
    }

    private static RemoteViews note(String pkg, String text, int color) {
        RemoteViews r = new RemoteViews(pkg, R.layout.widget_group_row);
        r.setTextViewText(R.id.tr_check, "");
        r.setTextViewText(R.id.tr_title, text);
        r.setTextColor(R.id.tr_title, color);
        r.setViewVisibility(R.id.tr_due, View.GONE);
        return r;
    }

    /** Android 12+ picks the layout by size itself; older launchers tell us the height (portrait: the max). */
    private static RemoteViews views(Context ctx, int widgetId, Bundle opts) {
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> m = new HashMap<>();
            for (int h : HEIGHTS) m.put(new SizeF(180f, h), build(ctx, widgetId, rowsFor(h)));
            return new RemoteViews(m);
        }
        int h = opts == null ? 200 : opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 200);
        return build(ctx, widgetId, rowsFor(h));
    }

    /* ---------- lifecycle ---------- */

    static int count(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, TasksWidget.class)).length;
    }

    static void update(Context ctx, int widgetId) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        mgr.updateAppWidget(widgetId, views(ctx, widgetId, mgr.getAppWidgetOptions(widgetId)));
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, TasksWidget.class))) mgr.updateAppWidget(id, views(ctx, id, mgr.getAppWidgetOptions(id)));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, views(ctx, id, mgr.getAppWidgetOptions(id)));
        Prefs p = Prefs.of(ctx);
        if (p.configured() && (System.currentTimeMillis() - p.glanceAt() > 30 * 60000 || p.glance() == null || p.glance().optJSONObject("tasks") == null)) refreshAsync(ctx, null);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        mgr.updateAppWidget(id, views(ctx, id, options));
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        for (int id : ids) Prefs.of(ctx).forgetTasksColumns(id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (DONE.equals(a)) { tick(ctx, intent.getStringExtra("id"), intent.getStringExtra("title")); refreshAsync(ctx, goAsync()); }
        else if (CYCLE.equals(a)) cycle(ctx, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID), intent.getIntExtra("side", 0));
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
