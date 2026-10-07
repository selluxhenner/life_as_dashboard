package com.kevinschmid.lifeos.pulse;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** The 15-minute background check. Always succeeds: a failed check simply waits for the next one. */
public class PulseWorker extends Worker {
    public PulseWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    @NonNull
    @Override
    public Result doWork() {
        Pulse.check(getApplicationContext(), false);
        return Result.success();
    }
}
