package com.kevinschmid.lifeos.pulse;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Sends queued widget captures once the network is back; tries again later while the server stays out of reach. */
public class CaptureWorker extends Worker {
    public CaptureWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    @NonNull
    @Override
    public Result doWork() {
        return Captures.flush(getApplicationContext()) ? Result.success() : Result.retry();
    }
}
