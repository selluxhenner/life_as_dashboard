package com.kevinschmid.lifeos.pulse;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Optional instant push. The server's message only says "check now" (no text goes through Google); the phone then
 * fetches its notifications itself. Only active when the app is built with android/app/google-services.json.
 */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Pulse.check(getApplicationContext(), false);       // already on a background thread
    }

    @Override
    public void onNewToken(@NonNull String token) {
        Pulse.sendPushToken(getApplicationContext(), token);
    }
}
