package com.kevinschmid.lifeos.pulse;

public class LiveTest {
    static void check(boolean c, String what) { if (!c) { System.out.println("FAIL: " + what); System.exit(1); } System.out.println("ok: " + what); }
    public static void main(String[] a) throws Exception {
        String[] partials = { null };
        LiveStt l = LiveStt.open("ws://127.0.0.1:" + a[0] + "/v1?model_id=x&token=tok", 2500, all -> partials[0] = all);
        check(l != null && l.ok(), "connects and gets session_started");
        short[] pcm = new short[1600];
        for (int i = 0; i < 12; i++) l.send(pcm, pcm.length);
        Thread.sleep(200);
        check("Hey Lina I want to".equals(partials[0]), "partial transcript arrives while sending: " + partials[0]);
        long t = System.currentTimeMillis();
        String first = l.commit(800);
        check(first.equals("Hey Lina, I want to explain \"the plan\" for tomorrow ü"), "commit returns the finalised text (unescaped): " + first);
        check(System.currentTimeMillis() - t < 300, "commit is fast: " + (System.currentTimeMillis() - t) + " ms");
        for (int i = 0; i < 3; i++) l.send(pcm, pcm.length);
        check(l.commit(800).endsWith("and then another sentence"), "second piece appends: " + l.text());
        l.reset();
        check(l.text().isEmpty(), "reset clears");
        check(LiveStt.textOf("{\"message_type\":\"x\",\"text\":\"a\u00e4\\\"b\nc\"}").equals("a\u00e4\"b\nc"), "json escapes");
        check(LiveStt.open("ws://127.0.0.1:" + a[0] + "/v1?token=bad", 1000, null) == null, "bad token gives null");
        l.close();
        check(!l.ok(), "close");
        System.out.println("ALL OK");
    }
}
