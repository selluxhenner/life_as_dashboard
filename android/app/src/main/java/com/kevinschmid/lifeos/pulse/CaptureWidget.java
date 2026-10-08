package com.kevinschmid.lifeos.pulse;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import com.kevinschmid.lifeos.R;

/**
 * Capture widget: the app's capture bar on the home screen. A widget cannot hold a text field, so the field opens
 * CaptureActivity, a capture bar over the home screen with the keyboard up; the count opens the list in the app.
 * The app reports the unsorted count (AgenticPlugin.setCaptures); captures made here add to it until it does.
 */
public class CaptureWidget extends AppWidgetProvider {

    private static RemoteViews build(Context ctx) {
        int n = Prefs.of(ctx).unsorted();
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_capture);
        Intent popup = new Intent(ctx, CaptureActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.c_field, PendingIntent.getActivity(ctx, 5400, popup, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        v.setOnClickPendingIntent(R.id.c_count, Alerts.open(ctx, "captures", null, 5401));
        v.setTextViewText(R.id.c_n, String.valueOf(n));
        v.setTextColor(R.id.c_label, n > 0 ? 0xFFE6EDF3 : 0xFF6B7A8C);
        v.setInt(R.id.c_count, "setBackgroundResource", n > 0 ? R.drawable.capture_count_has_bg : R.drawable.capture_count_bg);
        v.setContentDescription(R.id.c_count, n == 1 ? "1 capture to sort" : n + " captures to sort");
        v.setContentDescription(R.id.c_field, "Capture a thought");
        return v;
    }

    static int count(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, CaptureWidget.class)).length;
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, CaptureWidget.class));
        if (ids.length > 0) mgr.updateAppWidget(ids, build(ctx));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { mgr.updateAppWidget(ids, build(ctx)); }
}
