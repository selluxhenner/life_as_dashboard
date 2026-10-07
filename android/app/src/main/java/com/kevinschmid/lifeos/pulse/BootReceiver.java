package com.kevinschmid.lifeos.pulse;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms don't survive a reboot, an app update or a clock change: set the morning alarm again (WorkManager keeps itself). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Context app = ctx.getApplicationContext();
        Alerts.ensureChannels(app);
        Pulse.schedule(app);
        Pulse.refreshSurfaces(app);
    }
}
