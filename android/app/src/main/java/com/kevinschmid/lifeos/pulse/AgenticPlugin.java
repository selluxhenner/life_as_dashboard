package com.kevinschmid.lifeos.pulse;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.StatusBarManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.kevinschmid.lifeos.R;

/**
 * JS ↔ native for alerts (src/core/native.js): hands over the server and token, reports whether notifications can
 * actually arrive (permission, exact alarms, battery), adds the tile / widget, and passes notification taps on as
 * "route" events (agenticos://open/<route>?do=<action>).
 */
@CapacitorPlugin(name = "AgenticNative", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class AgenticPlugin extends Plugin {

    @Override
    public void load() {
        Alerts.ensureChannels(getContext());
        Intent i = getActivity().getIntent();
        if (route(i)) getActivity().setIntent(new Intent(i).setData(null));   // a recreated activity must not navigate again
    }

    @Override
    protected void handleOnNewIntent(Intent intent) { route(intent); }

    private boolean route(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"agenticos".equals(u.getScheme())) return false;
        String path = u.getPath() == null ? "" : u.getPath().replaceAll("^/+|/+$", "");
        JSObject d = new JSObject();
        d.put("route", path.isEmpty() ? "home" : path);
        String action = u.getQueryParameter("do");
        if (action != null) d.put("action", action);
        notifyListeners("route", d, true);                                      // kept until the web app listens
        return true;
    }

    private Context ctx() { return getContext().getApplicationContext(); }

    @PluginMethod
    public void configure(PluginCall call) {
        String url = call.getString("url", ""), token = call.getString("token", "");
        Prefs p = Prefs.of(ctx());
        if (url.isEmpty() || token.isEmpty()) { p.clearServer(); Pulse.cancel(ctx()); call.resolve(status()); return; }
        p.setServer(url, token);
        String bt = call.getString("briefingTime", "");
        if (bt.matches("\\d{2}:\\d{2}")) p.setBriefingTime(bt);
        Pulse.schedule(ctx());
        Pulse.BG.execute(() -> { Pulse.check(ctx(), true); Pulse.registerPush(ctx()); });
        call.resolve(status());
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Prefs.of(ctx()).clearServer();
        Pulse.cancel(ctx());
        Pulse.refreshSurfaces(ctx());
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(status()); }

    /** Check right away (the app calls this every minute while it is open). */
    @PluginMethod
    public void checkNow(PluginCall call) {
        boolean glance = Boolean.TRUE.equals(call.getBoolean("glance", false));
        Pulse.BG.execute(() -> {
            String err = Pulse.check(ctx(), glance);
            JSObject r = status();
            r.put("error", err);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { call.resolve(status()); return; }
        Prefs.of(ctx()).setAskedNotifications();
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) { call.resolve(status()); }

    /** kind: breaking | ai | calendar | morning (the real morning notification from today's glance). */
    @PluginMethod
    public void test(PluginCall call) {
        String kind = call.getString("kind", "breaking");
        Pulse.BG.execute(() -> {
            if ("morning".equals(kind)) {
                Pulse.check(ctx(), true);
                Alerts.morning(ctx(), Prefs.of(ctx()).glance(), null);
            } else Alerts.test(ctx(), kind);
            call.resolve(status());
        });
    }

    @PluginMethod
    public void setPinned(PluginCall call) {
        Prefs p = Prefs.of(ctx());
        p.setPinned(Boolean.TRUE.equals(call.getBoolean("on", false)));
        Alerts.pinned(ctx(), p.glance());
        call.resolve(status());
    }

    /** Android 13+: the system asks "Add tile to Quick Settings?". */
    @PluginMethod
    public void addTile(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) { JSObject r = new JSObject(); r.put("result", "unsupported"); call.resolve(r); return; }
        StatusBarManager sbm = ctx().getSystemService(StatusBarManager.class);
        sbm.requestAddTileService(new ComponentName(ctx(), BriefingTile.class), getContext().getString(R.string.tile_label),
            Icon.createWithResource(ctx(), R.drawable.ic_stat_agentic), ctx().getMainExecutor(), code -> {
                JSObject r = new JSObject();
                // 0 not added, 1 already there, 2 added; anything else is an error code
                r.put("result", code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ? "added"
                    : code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED ? "already" : code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED ? "declined" : "error " + code);
                call.resolve(r);
            });
    }

    /** The launcher asks where to put the widget. which: "day" (day plan with rooms) or "glance" (briefing + news). */
    @PluginMethod
    public void addWidget(PluginCall call) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx());
        JSObject r = new JSObject();
        Class<?> provider = "day".equals(call.getString("which", "glance")) ? DayWidget.class : GlanceWidget.class;
        boolean ok = Build.VERSION.SDK_INT >= 26 && m.isRequestPinAppWidgetSupported()
            && m.requestPinAppWidget(new ComponentName(ctx(), provider), null, null);
        r.put("result", ok ? "asked" : "unsupported");
        call.resolve(r);
    }

    /** what: notifications | battery | alarms | app */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String what = call.getString("what", "app");
        String pkg = getContext().getPackageName();
        Intent i;
        if ("notifications".equals(what) && Build.VERSION.SDK_INT >= 26) i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        else if ("battery".equals(what)) i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
        else if ("alarms".equals(what) && Build.VERSION.SDK_INT >= 31) i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg));
        else i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        try { getActivity().startActivity(i); }
        catch (Exception e) { getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg))); }
        call.resolve(status());
    }

    private JSObject status() {
        Context c = ctx();
        Prefs p = Prefs.of(c);
        JSObject s = new JSObject();
        boolean enabled = NotificationManagerCompat.from(c).areNotificationsEnabled();
        s.put("notifications", enabled ? "granted" : Build.VERSION.SDK_INT >= 33 && !p.askedNotifications() ? "prompt" : "denied");
        JSArray off = new JSArray();
        if (Build.VERSION.SDK_INT >= 26) {
            for (NotificationChannel ch : c.getSystemService(NotificationManager.class).getNotificationChannels())
                if (ch.getImportance() == NotificationManager.IMPORTANCE_NONE) off.put(ch.getId());
        }
        s.put("channelsOff", off);
        s.put("exactAlarms", Pulse.canExact(c));
        s.put("batteryUnrestricted", c.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(c.getPackageName()));
        s.put("configured", p.configured());
        s.put("briefingTime", p.briefingTime());
        s.put("nextMorningAt", p.nextMorningAt());
        s.put("lastCheckAt", p.lastCheckAt());
        s.put("lastError", p.lastError());
        s.put("glanceAt", p.glanceAt());
        s.put("pinned", p.pinned());
        s.put("firebase", Pulse.firebase(c));
        s.put("pushRegistered", !p.pushSent().isEmpty());
        s.put("canAddTile", Build.VERSION.SDK_INT >= 33);
        s.put("canAddWidget", Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(c).isRequestPinAppWidgetSupported());
        s.put("widgets", GlanceWidget.count(c));
        s.put("dayWidgets", DayWidget.count(c));
        s.put("sdk", Build.VERSION.SDK_INT);
        return s;
    }
}
