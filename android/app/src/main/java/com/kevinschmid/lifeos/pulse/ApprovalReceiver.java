package com.kevinschmid.lifeos.pulse;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.kevinschmid.lifeos.R;

import org.json.JSONObject;

/** Approve / Reject right on an approval notification: Hermes's server actions ("approval:apr_…") and
 *  Lina's queued sends ("action:act_…"). The result replaces the notification. */
public class ApprovalReceiver extends BroadcastReceiver {
    private static final String DECIDE = "com.kevinschmid.lifeos.approval.DECIDE";

    static PendingIntent decide(Context c, String ref, int notif, boolean approve) {
        Intent i = new Intent(c, ApprovalReceiver.class).setAction(DECIDE)
            .putExtra("ref", ref).putExtra("notif", notif).putExtra("approve", approve);
        return PendingIntent.getBroadcast(c, notif * 2 + (approve ? 0 : 1), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The server path for a notification ref, or null when the notification is not an approval. */
    static String pathFor(String ref) {
        if (ref == null) return null;
        if (ref.matches("approval:apr_[A-Za-z0-9_-]+")) return "/api/approvals/" + ref.substring("approval:".length());
        if (ref.matches("action:act_\\w+")) return "/api/agent/actions/" + ref.substring("action:".length());
        return null;
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!DECIDE.equals(intent.getAction())) return;
        Context c = ctx.getApplicationContext();
        String path = pathFor(intent.getStringExtra("ref"));
        int notif = intent.getIntExtra("notif", 0);
        boolean approve = intent.getBooleanExtra("approve", false);
        if (path == null) return;
        PendingResult pr = goAsync();
        Pulse.BG.execute(() -> {
            String text;
            try {
                Server.post(Prefs.of(c), path + (approve ? "/approve" : "/reject"), new JSONObject());
                text = approve ? "Approved." : "Rejected.";
            } catch (Server.AuthException e) {
                text = e.getMessage();
            } catch (Exception e) {
                // 409: decided elsewhere (Telegram, another device) or expired
                text = String.valueOf(e.getMessage()).contains("409") ? "Already decided or expired." : "Couldn't reach your server: " + e.getMessage();
            }
            try {
                NotificationManagerCompat.from(c).notify(notif, new NotificationCompat.Builder(c, "agent")
                    .setSmallIcon(R.drawable.ic_stat_agentic).setColor(Alerts.SIGNAL)
                    .setContentTitle("Approval").setContentText(text).setAutoCancel(true).setTimeoutAfter(15000)
                    .setContentIntent(Alerts.open(c, "hub", null, notif)).build());
            } catch (SecurityException ignored) { /* notifications off */ }
            pr.finish();
        });
    }
}
