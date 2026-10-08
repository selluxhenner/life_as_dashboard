package com.kevinschmid.lifeos.pulse;

import android.content.Context;

import com.k2fsa.sherpa.onnx.KeywordSpotter;
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;

import java.io.IOException;
import java.util.Arrays;

/**
 * "Hey Lina" on the phone itself: sherpa-onnx keyword spotting with a 3.3 M-parameter Zipformer (int8, assets/kws,
 * packed by lina.gradle). Phrases are in assets/kws/keywords.txt (android/app/lina/keywords.txt). No audio leaves
 * the phone for this; feed it 16 kHz mono and it says when it heard one.
 */
final class Wake {
    static final int RATE = 16000;
    private static final String DIR = "kws/", M = "-epoch-12-avg-2-chunk-16-left-64.int8.onnx";

    private final KeywordSpotter kws;
    private OnlineStream stream;

    /** The model is in the APK and the device runs one of the packed ABIs (arm64-v8a, x86_64). */
    static boolean available(Context c) {
        try {
            if (!Arrays.asList(c.getAssets().list("kws")).contains("tokens.txt")) return false;
            return c.getApplicationInfo().nativeLibraryDir != null && new java.io.File(c.getApplicationInfo().nativeLibraryDir, "libsherpa-onnx-jni.so").exists();
        } catch (IOException e) { return false; }
    }

    /** sensitivity: low | normal | high. Higher wakes more easily (and more often by mistake; the server then ignores it). */
    Wake(Context c, String sensitivity) {
        OnlineTransducerModelConfig t = new OnlineTransducerModelConfig();
        t.setEncoder(DIR + "encoder" + M);
        t.setDecoder(DIR + "decoder" + M);
        t.setJoiner(DIR + "joiner" + M);
        OnlineModelConfig m = new OnlineModelConfig();
        m.setTransducer(t);
        m.setTokens(DIR + "tokens.txt");
        m.setModelType("zipformer2");
        m.setNumThreads(1);
        m.setProvider("cpu");
        KeywordSpotterConfig k = new KeywordSpotterConfig();
        k.setModelConfig(m);
        k.setKeywordsFile(DIR + "keywords.txt");
        // Tuned on English and German test phrases: "normal" caught Hey/Hi/Hallo Lina, its only miss-fire was "Hey Linda".
        float[] st = "low".equals(sensitivity) ? new float[] { 2.0f, 0.25f } : "high".equals(sensitivity) ? new float[] { 3.5f, 0.05f } : new float[] { 3.0f, 0.1f };
        k.setKeywordsScore(st[0]);
        k.setKeywordsThreshold(st[1]);
        k.setNumTrailingBlanks(1);
        kws = new KeywordSpotter(c.getAssets(), k);
        stream = kws.createStream("");
    }

    /** Returns the keyword ("HEY_LINA" …) when one ends in these samples, else null. */
    String feed(float[] samples) {
        stream.acceptWaveform(samples, RATE);
        while (kws.isReady(stream)) {
            kws.decode(stream);
            String k = kws.getResult(stream).getKeyword();
            if (k != null && !k.isEmpty()) { kws.reset(stream); return k; }
        }
        return null;
    }

    /** Forget what was heard (after a conversation, so its words can't complete a half-heard phrase). */
    void reset() { stream.release(); stream = kws.createStream(""); }

    void release() { stream.release(); kws.release(); }
}
