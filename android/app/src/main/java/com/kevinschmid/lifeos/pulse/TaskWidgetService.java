package com.kevinschmid.lifeos.pulse;

import android.content.Context;
import android.content.Intent;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.kevinschmid.lifeos.R;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** The rows of the Tasks widget's scrolling list. */
public class TaskWidgetService extends RemoteViewsService {
    static final String ID = "task", ACT = "act", ACT_TOGGLE = "toggle", ACT_OPEN = "open";
    // Priority rings, from src/styles/tokens.css
    private static final int FLARE = 0xFFFF4D5E, SIGNAL = 0xFF4FE3FF, MUTED = 0xFF6B7A8C, AMBER = 0xFFFFC857;
    private static final int TEXT = 0xFFE6EDF3, DONE_TEXT = 0xFF6B7A8C;

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Rows(getApplicationContext()); }

    private static final class Rows implements RemoteViewsFactory {
        private final Context ctx;
        private List<JSONObject> rows = new ArrayList<>();

        Rows(Context ctx) { this.ctx = ctx; }

        @Override public void onCreate() { rows = Tasks.shown(ctx); }
        @Override public void onDataSetChanged() { rows = Tasks.shown(ctx); }
        @Override public void onDestroy() { rows.clear(); }
        @Override public int getCount() { return rows.size(); }
        @Override public long getItemId(int i) { return i < rows.size() ? rows.get(i).optString("id").hashCode() : i; }
        @Override public boolean hasStableIds() { return true; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public RemoteViews getLoadingView() { return null; }

        @Override
        public RemoteViews getViewAt(int i) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_task_row);
            if (i >= rows.size()) return v;
            JSONObject t = rows.get(i);
            boolean done = t.optBoolean("done");
            String title = t.optString("title").trim();

            SpannableString shown = new SpannableString(title);
            if (done) shown.setSpan(new StrikethroughSpan(), 0, title.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            v.setTextViewText(R.id.tr_title, shown);
            v.setTextColor(R.id.tr_title, done ? DONE_TEXT : TEXT);

            int ring = "high".equals(t.optString("priority")) ? FLARE : "low".equals(t.optString("priority")) ? MUTED : SIGNAL;
            v.setImageViewResource(R.id.tr_ring, done ? R.drawable.task_ring_done : R.drawable.task_ring);
            v.setInt(R.id.tr_ring, "setColorFilter", ring);
            v.setContentDescription(R.id.tr_ring_hit, (done ? "Undo: " : "Done: ") + title);

            String[] due = due(t.isNull("due") ? "" : t.optString("due"));
            String project = t.isNull("project") ? "" : t.optString("project").trim();
            String meta = due[0] + (!due[0].isEmpty() && !project.isEmpty() ? " · " : "") + project;
            v.setTextViewText(R.id.tr_meta, meta.toUpperCase(Locale.ENGLISH));
            v.setTextColor(R.id.tr_meta, done ? DONE_TEXT : "overdue".equals(due[1]) ? FLARE : "today".equals(due[1]) ? AMBER : MUTED);
            v.setViewVisibility(R.id.tr_meta, meta.isEmpty() ? View.GONE : View.VISIBLE);
            v.setViewVisibility(R.id.tr_rule, i == rows.size() - 1 ? View.GONE : View.VISIBLE);

            v.setOnClickFillInIntent(R.id.tr_ring_hit, new Intent().putExtra(ID, t.optString("id")).putExtra(ACT, ACT_TOGGLE));
            v.setOnClickFillInIntent(R.id.tr_body, new Intent().putExtra(ID, t.optString("id")).putExtra(ACT, ACT_OPEN));
            return v;
        }

        /** "Today" / "Tomorrow" / "Overdue · 12 Oct" / "Fri 24 Oct", and which of those it is. */
        private static String[] due(String ymd) {
            if (!ymd.matches("\\d{4}-\\d{2}-\\d{2}")) return new String[] { "", "" };
            try {
                SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                in.setLenient(false);
                Calendar d = Calendar.getInstance();
                d.setTime(in.parse(ymd));
                Calendar today = Calendar.getInstance();
                today.set(Calendar.HOUR_OF_DAY, 0); today.set(Calendar.MINUTE, 0); today.set(Calendar.SECOND, 0); today.set(Calendar.MILLISECOND, 0);
                long days = Math.round((d.getTimeInMillis() - today.getTimeInMillis()) / 86400000.0);
                String label = new SimpleDateFormat(d.get(Calendar.YEAR) == today.get(Calendar.YEAR) ? "EEE d MMM" : "d MMM yyyy", Locale.ENGLISH).format(d.getTime());
                if (days < 0) return new String[] { "Overdue · " + new SimpleDateFormat("d MMM", Locale.ENGLISH).format(d.getTime()), "overdue" };
                if (days == 0) return new String[] { "Today", "today" };
                if (days == 1) return new String[] { "Tomorrow", "soon" };
                return new String[] { label, "later" };
            } catch (Exception e) { return new String[] { "", "" }; }
        }
    }
}
