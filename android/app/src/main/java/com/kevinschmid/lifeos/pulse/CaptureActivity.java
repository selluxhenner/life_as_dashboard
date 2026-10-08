package com.kevinschmid.lifeos.pulse;

import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.kevinschmid.lifeos.R;

/**
 * The Capture widget's popup: a capture bar over the home screen with the keyboard up, so a thought is written down
 * without opening the app. Enter saves (a pasted list becomes one capture per line, as in Notes). Leaving any other way
 * (back, a tap outside, home) keeps the text as a draft for next time.
 */
public class CaptureActivity extends AppCompatActivity {
    private EditText field;
    private View send;
    private boolean saved;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_capture);

        View root = findViewById(R.id.cap_root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);   // the bar sits right above the keyboard
            return WindowInsetsCompat.CONSUMED;
        });
        root.setOnClickListener(v -> finish());

        field = findViewById(R.id.cap_text);
        send = findViewById(R.id.cap_send);
        // Wraps like a multi-line field, but the keyboard shows a Send key instead of a new-line key.
        field.setRawInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT);
        field.setOnEditorActionListener((v, action, ev) -> {
            boolean enter = ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER;
            if (enter && ev.isShiftPressed()) return false;     // hardware keyboard: Shift+Enter is a new line
            if (enter && ev.getAction() != KeyEvent.ACTION_DOWN) return true;
            if (action == EditorInfo.IME_ACTION_SEND || enter) { save(); return true; }
            return false;
        });
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { sendable(); }
        });
        send.setOnClickListener(v -> save());

        if (state == null) {
            String draft = Prefs.of(this).captureDraft();
            field.setText(draft);
            field.setSelection(draft.length());
        }
        sendable();
        field.requestFocus();
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) field.post(() -> getSystemService(InputMethodManager.class).showSoftInput(field, InputMethodManager.SHOW_IMPLICIT));
    }

    private void sendable() {
        boolean on = field.getText().toString().trim().length() > 0;
        send.setEnabled(on);
        send.setAlpha(on ? 1f : 0.35f);
    }

    private void save() {
        String text = field.getText().toString();
        if (text.trim().isEmpty()) return;
        int n = Captures.add(getApplicationContext(), text);
        saved = true;
        Prefs.of(this).setCaptureDraft("");
        Toast.makeText(getApplicationContext(), n == 1 ? "Captured" : n + " captures added", Toast.LENGTH_SHORT).show();
        finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (!saved) Prefs.of(this).setCaptureDraft(field.getText().toString());
    }

    /** A popup, not a place to come back to: once it is out of sight it is gone (the draft stays). */
    @Override
    protected void onStop() {
        super.onStop();
        if (!isFinishing() && !isChangingConfigurations()) finish();
    }
}
