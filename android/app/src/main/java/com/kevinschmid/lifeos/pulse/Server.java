package com.kevinschmid.lifeos.pulse;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Tiny JSON client for the Agentic OS server, with the device token. Short timeouts: it runs in alarms and pushes. */
final class Server {
    static final class AuthException extends IOException { AuthException() { super("The server rejected this device's token. Pair it again in Settings."); } }

    private Server() {}

    static JSONObject get(Prefs p, String path) throws Exception { return call(p, "GET", path, null); }
    static JSONObject post(Prefs p, String path, JSONObject body) throws Exception { return call(p, "POST", path, body); }

    private static JSONObject call(Prefs p, String method, String path, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(p.url().replaceAll("/+$", "") + path).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(8000);
            c.setReadTimeout(12000);
            c.setRequestProperty("Authorization", "Bearer " + p.token());
            c.setRequestProperty("Accept", "application/json");
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int code = c.getResponseCode();
            if (code == 401) throw new AuthException();
            String text = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
            if (code >= 400) throw new IOException("Server answered " + code);
            return new JSONObject(text);
        } finally { c.disconnect(); }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = is.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
