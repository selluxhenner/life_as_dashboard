package com.kevinschmid.lifeos.pulse;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Sends tasks ticked off or added in the Tasks widget once the network is back; tries again later while the server stays out of reach. */
public class TaskWorker extends Worker {
    public TaskWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    @NonNull
    @Override
    public Result doWork() {
        return Tasks.flush(getApplicationContext()) ? Result.success() : Result.retry();
    }
}
