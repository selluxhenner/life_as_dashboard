package com.kevinschmid.lifeos.pulse;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.kevinschmid.lifeos.MainActivity;

/**
 * A tap on a row of the Tasks widget. A list row can only carry one kind of PendingIntent, and starting the app from a
 * broadcast is not allowed in the background, so both taps land here: the ring ticks the task off and this closes at
 * once without a window; the row opens Today in the app.
 */
public class TaskTapActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent i = getIntent();
        String id = i.getStringExtra(TaskWidgetService.ID);
        if (TaskWidgetService.ACT_OPEN.equals(i.getStringExtra(TaskWidgetService.ACT))) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("agenticos://open/today"), this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } else if (id != null) {
            Tasks.toggle(getApplicationContext(), id);
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
