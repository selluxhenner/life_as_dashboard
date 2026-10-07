package com.kevinschmid.lifeos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.kevinschmid.lifeos.pulse.AgenticPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AgenticPlugin.class);       // native alerts, widget, tile (android/app/src/main/java/…/pulse)
        super.onCreate(savedInstanceState);
    }
}
