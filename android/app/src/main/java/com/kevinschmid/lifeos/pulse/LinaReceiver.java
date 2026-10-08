package com.kevinschmid.lifeos.pulse;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.kevinschmid.lifeos.R;

import org.json.JSONObject;

/** Lina's notification buttons: Send / Don't send for a waiting invitation, and Stop listening. */
public class LinaReceiver extends BroadcastReceiver {
    static final String STOP = "com.kevinschmid.lifeos.lina.STOP";
    private static final String DECIDE = "com.kevinschmid.lifeos.lina.DECIDE";

    static PendingIntent decide(Context c, String ids, boolean approve) {
        Intent i = new Intent(c, LinaReceiver.class).setAction(DECIDE).putExtra("ids", ids).putExtra("approve", approve);
        return PendingIntent.getBroadcast(c, approve ? 4320 : 4321, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        Context c = ctx.getApplicationContext();
        if (STOP.equals(intent.getAction())) {
            Prefs.of(c).setLinaWake(false);
            LinaService.stop(c);
            return;
        }
        if (!DECIDE.equals(intent.getAction())) return;
        String ids = intent.getStringExtra("ids");
        boolean approve = intent.getBooleanExtra("approve", false);
        if (ids == null || ids.isEmpty()) return;
        PendingResult pr = goAsync();
        Pulse.BG.execute(() -> {
            String text;
            try {
                String err = null;
                for (String id : ids.split(",")) {
                    if (!id.matches("act_\\w+")) continue;
                    JSONObject r = Server.post(Prefs.of(c), "/api/agent/actions/" + id + "/" + (approve ? "approve" : "reject"), new JSONObject());
                    if (r.has("error")) err = r.optString("error");
                }
                text = err != null ? "Didn't work: " + err : approve ? "Sent. The invitation is on its way." : "Okay, not sent.";
            } catch (Exception e) {
                text = "Couldn't reach your server: " + e.getMessage();
            }
            try {
                NotificationManagerCompat.from(c).notify(LinaService.ID_REPLY, new NotificationCompat.Builder(c, LinaService.CH_REPLY)
                    .setSmallIcon(R.drawable.ic_stat_agentic).setColor(Alerts.SIGNAL)
                    .setContentTitle("Lina").setContentText(text).setAutoCancel(true)
                    .setContentIntent(Alerts.open(c, "assistant", null, 4312)).build());
            } catch (SecurityException ignored) { /* notifications off */ }
            pr.finish();
        });
    }
}
