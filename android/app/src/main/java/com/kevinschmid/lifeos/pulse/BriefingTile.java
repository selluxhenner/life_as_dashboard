package com.kevinschmid.lifeos.pulse;

import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import com.kevinschmid.lifeos.R;

import org.json.JSONObject;

/**
 * Quick Settings tile "Briefing" — reachable from the lock screen by pulling down the shade. Tapping it shows today's
 * briefing right there, without unlocking; "Open" (or "Listen") unlocks and opens the app.
 */
public class BriefingTile extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        JSONObject b = Alerts.briefingToday(Prefs.of(this).glance());
        t.setLabel(getString(R.string.tile_label));
        if (Build.VERSION.SDK_INT >= 29) t.setSubtitle(b != null ? "Today's is ready" : "Today");
        t.setState(b != null ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.setIcon(Icon.createWithResource(this, R.drawable.ic_stat_agentic));
        t.updateTile();
    }

    @Override
    public void onClick() {
        Prefs p = Prefs.of(this);
        JSONObject g = p.glance();
        JSONObject b = Alerts.briefingToday(g);
        String title, text;
        if (!p.configured()) { title = "Agentic OS"; text = "Open the app once to connect it to your server."; }
        else if (b != null) { title = "Today · " + Alerts.dayName(); text = Alerts.briefingText(b); }
        else {
            title = "Today · " + Alerts.dayName();
            String top = Alerts.worldLine(g, 0);
            text = "Your briefing arrives at " + p.briefingTime() + "." + (top != null ? "\n\nWorld: " + top : "");
        }
        AlertDialog d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(title)
            .setMessage(text)
            .setPositiveButton("Open", (di, w) -> openApp("home", null))
            .setNeutralButton(b != null ? "Listen" : "World", (di, w) -> openApp(b != null ? "home" : "news", b != null ? "listen" : null))
            .setNegativeButton("Close", null)
            .create();
        showDialog(d);
        if (p.configured() && System.currentTimeMillis() - p.glanceAt() > 10 * 60000) Pulse.BG.execute(() -> Pulse.check(getApplicationContext(), true));
    }

    private void openApp(String route, String action) {
        Runnable go = () -> {
            PendingIntent pi = Alerts.open(this, route, action, 5200);
            if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(pi);
            else {
                Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("agenticos://open/" + route + (action == null ? "" : "?do=" + action)),
                    this, com.kevinschmid.lifeos.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivityAndCollapseCompat(i);
            }
        };
        if (isLocked()) unlockAndRun(go); else go.run();
    }

    @SuppressWarnings("deprecation")
    private void startActivityAndCollapseCompat(Intent i) { startActivityAndCollapse(i); }
}
