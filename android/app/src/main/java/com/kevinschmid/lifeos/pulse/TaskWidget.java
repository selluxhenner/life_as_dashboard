package com.kevinschmid.lifeos.pulse;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import com.kevinschmid.lifeos.R;

/**
 * Tasks widget: the open todos as a list that scrolls inside the widget. The ring ticks a task off (tap again within
 * a few seconds to undo), the row opens Today in the app, + types a new task over the home screen.
 */
public class TaskWidget extends AppWidgetProvider {

    @SuppressWarnings("deprecation")   // setRemoteAdapter(Intent): the replacement (RemoteCollectionItems) needs Android 12
    private static RemoteViews build(Context ctx, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_tasks);
        int n = Tasks.open(ctx);
        v.setTextViewText(R.id.t_count, String.valueOf(n));
        v.setTextViewText(R.id.t_sub, Alerts.dayLabel() + " · " + (n == 0 ? "ALL DONE" : n + " OPEN"));
        v.setOnClickPendingIntent(R.id.t_head, Alerts.open(ctx, "today", null, 5500));

        Intent add = new Intent(ctx, CaptureActivity.class).putExtra(CaptureActivity.MODE, CaptureActivity.MODE_TASK)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.t_add, PendingIntent.getActivity(ctx, 5501, add, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        // the list; the data URI keeps one adapter per widget
        Intent svc = new Intent(ctx, TaskWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.t_list, svc);
        v.setEmptyView(R.id.t_list, R.id.t_empty);
        v.setOnClickPendingIntent(R.id.t_empty, PendingIntent.getActivity(ctx, 5501, add, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        // each row fills in which task and whether the ring or the row was tapped (TaskTapActivity)
        Intent tap = new Intent(ctx, TaskTapActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        v.setPendingIntentTemplate(R.id.t_list, PendingIntent.getActivity(ctx, 5502, tap, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return v;
    }

    static int count(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, TaskWidget.class)).length;
    }

    @SuppressWarnings("deprecation")   // notifyAppWidgetViewDataChanged: the replacement (RemoteCollectionItems) needs Android 12
    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TaskWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.t_list);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        Prefs p = Prefs.of(ctx);
        if (p.configured() && System.currentTimeMillis() - p.tasksAt() > 15 * 60000) {
            Context app = ctx.getApplicationContext();
            PendingResult result = goAsync();
            Pulse.BG.execute(() -> { try { Tasks.refresh(app); } finally { result.finish(); } });
        }
    }
}
