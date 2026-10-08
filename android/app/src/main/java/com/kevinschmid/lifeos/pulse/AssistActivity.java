package com.kevinschmid.lifeos.pulse;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.kevinschmid.lifeos.MainActivity;

/**
 * Lina as the phone's assistant: with Agentic OS chosen under Settings › Apps › Default apps › Digital assistant,
 * holding the power (or home) button lands here. No window: it starts LinaService, which listens right away and
 * answers by voice. On the lock screen it asks to unlock first, because Lina can read the calendar and inbox.
 */
public class AssistActivity extends Activity {
    private static final int MIC = 7;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!Prefs.of(this).configured()) { openApp("settings"); return; }
        if (!LinaService.hasMic(this)) {
            if (Build.VERSION.SDK_INT >= 23) { requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MIC); return; }
            openApp("settings"); return;
        }
        unlockThenTalk();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == MIC && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) unlockThenTalk();
        else finish();
    }

    private void unlockThenTalk() {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (Build.VERSION.SDK_INT >= 26 && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { talk(); }
                @Override public void onDismissCancelled() { finish(); }
                @Override public void onDismissError() { finish(); }
            });
        } else talk();
    }

    private void talk() {
        LinaService.start(this, LinaService.ACT_TALK);
        finish();
        overridePendingTransition(0, 0);
    }

    private void openApp(String route) {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("agenticos://open/" + route), this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }
}
