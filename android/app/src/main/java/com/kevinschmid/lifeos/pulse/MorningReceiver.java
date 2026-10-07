package com.kevinschmid.lifeos.pulse;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires at the briefing time (exact alarm, also in Doze). Network work runs off the main thread. */
public class MorningReceiver extends BroadcastReceiver {
    static final String ACTION = "com.kevinschmid.lifeos.pulse.MORNING";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;
        PendingResult result = goAsync();
        Context app = ctx.getApplicationContext();
        Pulse.BG.execute(() -> {
            try { Pulse.morningAlarm(app); } finally { result.finish(); }
        });
    }
}
