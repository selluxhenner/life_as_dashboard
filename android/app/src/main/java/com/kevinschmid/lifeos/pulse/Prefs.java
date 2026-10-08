package com.kevinschmid.lifeos.pulse;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/** What the background side needs without the WebView: server, device token, what was already shown, the cached glance. */
public final class Prefs {
    private final SharedPreferences sp;

    private Prefs(Context ctx) { sp = ctx.getApplicationContext().getSharedPreferences("agentic_pulse", Context.MODE_PRIVATE); }
    public static Prefs of(Context ctx) { return new Prefs(ctx); }

    public boolean configured() { return !url().isEmpty() && !token().isEmpty(); }
    public String url() { return sp.getString("url", ""); }
    public String token() { return sp.getString("token", ""); }
    /** Returns true when the server or token changed (the cursor then starts over). */
    public boolean setServer(String url, String token) {
        boolean changed = !url.equals(url()) || !token.equals(token());
        SharedPreferences.Editor e = sp.edit().putString("url", url).putString("token", token);
        if (changed) e.putLong("lastId", 0).putBoolean("primed", false).remove("glance").remove("pushSent");
        e.apply();
        return changed;
    }
    public void clearServer() { sp.edit().remove("url").remove("token").remove("glance").putLong("lastId", 0).putBoolean("primed", false).apply(); }

    /** Highest notification id already handled; the first check after pairing only takes the cursor (no backlog). */
    public long lastId() { return sp.getLong("lastId", 0); }
    public boolean primed() { return sp.getBoolean("primed", false); }
    public void setCursor(long id) { sp.edit().putLong("lastId", Math.max(id, lastId())).putBoolean("primed", true).apply(); }

    public String briefingTime() { return sp.getString("briefingTime", "08:00"); }
    public void setBriefingTime(String hm) { sp.edit().putString("briefingTime", hm).apply(); }

    /** Date (yyyy-MM-dd) and kind ("briefing" or "reminder") of the last morning notification. */
    public String morningDate() { return sp.getString("morningDate", ""); }
    public String morningKind() { return sp.getString("morningKind", ""); }
    public void setMorning(String date, String kind) { sp.edit().putString("morningDate", date).putString("morningKind", kind).apply(); }

    public JSONObject glance() {
        try { String s = sp.getString("glance", null); return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }
    public long glanceAt() { return sp.getLong("glanceAt", 0); }
    public void setGlance(JSONObject g) { sp.edit().putString("glance", g.toString()).putLong("glanceAt", System.currentTimeMillis()).apply(); }

    public boolean pinned() { return sp.getBoolean("pinned", false); }
    public void setPinned(boolean on) { sp.edit().putBoolean("pinned", on).apply(); }

    public long lastCheckAt() { return sp.getLong("lastCheckAt", 0); }
    public String lastError() { return sp.getString("lastError", ""); }
    public void checked(String error) { sp.edit().putLong("lastCheckAt", System.currentTimeMillis()).putString("lastError", error == null ? "" : error).apply(); }

    public long nextMorningAt() { return sp.getLong("nextMorningAt", 0); }
    public void setNextMorningAt(long t) { sp.edit().putLong("nextMorningAt", t).apply(); }

    /** The Firebase token last registered with the server ("" = none). */
    public String pushSent() { return sp.getString("pushSent", ""); }
    public void setPushSent(String token) { sp.edit().putString("pushSent", token).apply(); }

    /** Captures waiting to be sorted, as the app last reported it (the Capture widget shows it). */
    public int unsorted() { return sp.getInt("unsorted", 0); }
    public void setUnsorted(int n) { sp.edit().putInt("unsorted", n).apply(); }

    /** Widget captures the server does not have yet, as a JSON array (see Captures). */
    public String captureQueue() { return sp.getString("captureQueue", "[]"); }
    public void setCaptureQueue(String json) { sp.edit().putString("captureQueue", json).apply(); }

    /** What was left in the capture popup when it closed without saving. */
    public String captureDraft() { return sp.getString("captureDraft", ""); }
    public void setCaptureDraft(String text) { sp.edit().putString("captureDraft", text).apply(); }

    public boolean askedNotifications() { return sp.getBoolean("askedNotifications", false); }
    public void setAskedNotifications() { sp.edit().putBoolean("askedNotifications", true).apply(); }
}
