package com.samaritantechs.hopecalls;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * IMPREST ALERTS INSIDE THE APP.
 *
 *   "I thought we allow notification even from app too"
 *
 * A WebView has no push service, so the browser's Web Push cannot reach this app. Instead the
 * portal page, when it runs in here, registers this handset in the same notification register
 * as a browser would (apk:<device id>), and the server queues this code's imprest alerts for it
 * (api/_lib/push.js, pushPending). This class asks for that queue and draws each item on the
 * phone's own tray -- one POST to /api/portal { code, fn: 'pushPending' } per poll, answered
 * from one small settings row, nothing else read.
 *
 * Who polls, and how often, is the server's call: it answers with `interval` (seconds) -- two
 * minutes for an approver's code, ten for a requester's, zero for a code that holds no imprest
 * pane or has no app registered. MainActivity polls on that clock while the app is on screen;
 * AlertJobService every fifteen minutes in the background. Officers in HOPE Calls without a
 * portal code never poll: there is no code to ask with.
 */
final class AlertPoller {
    static final String CHANNEL_ID = "hope_imprest";
    static final String PREF_SINCE = "alertSince";
    static final String EXTRA_URL = "hopeUrl";
    private static final int ID_BASE = 5000;

    private AlertPoller() {}

    /** One poll: ask, draw what is new, remember the newest. Blocking -- call off the UI thread.
        Returns the server's interval in seconds; 0 means "this code hears nothing, stop asking";
        -1 means the ask itself failed (no network, a refused code) and should be tried later. */
    static int pollNow(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences("hopecalls", Context.MODE_PRIVATE);
        String code = prefs.getString("officerCode", "");
        if (code.isEmpty()) return 0;
        String device = prefs.getString("deviceId", "");
        long since = prefs.getLong(PREF_SINCE, 0L);
        HttpURLConnection c = null;
        try {
            JSONObject args = new JSONObject();
            args.put("device", device);
            args.put("since", since);
            JSONObject body = new JSONObject();
            body.put("code", code);
            body.put("fn", "pushPending");
            body.put("args", args);
            String base = MainActivity.resolveStartUrl(prefs).replaceAll("/+$", "");
            c = (HttpURLConnection) new URL(base + "/api/portal").openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setDoOutput(true);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (c.getResponseCode() != 200) return -1;
            BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            JSONObject j = new JSONObject(sb.toString());
            JSONArray items = j.optJSONArray("items");
            long newest = since;
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject it = items.getJSONObject(i);
                    long at = it.optLong("at", 0L);
                    if (at <= since) continue;      // drawn on an earlier poll
                    show(ctx, it.optString("title", "HOPE PMO"), it.optString("body", ""),
                            it.optString("url", "/dashboard"), it.optString("tag", ""), at);
                    if (at > newest) newest = at;
                }
            }
            if (newest != since) prefs.edit().putLong(PREF_SINCE, newest).apply();
            return j.optInt("interval", 0);
        } catch (Exception e) {
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** The tray entry: high importance (a sound and a buzz, the point of the whole thing), one
        per imprest request (the tag), a tap opening the request in the portal. Silently nothing
        on Android 13+ when the notification permission was refused -- requestMissingPermissions
        asks for it again at the next launch. */
    private static void show(Context ctx, String title, String text, String url, String tag, long at) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    "Arifa za imprest / Imprest alerts", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Ombi, idhini na malipo ya imprest yanayokuhusu / imprest requests, decisions and payments that concern you");
            nm.createNotificationChannel(ch);
        }
        Intent tap = new Intent(ctx, MainActivity.class);
        tap.putExtra(EXTRA_URL, url);
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = tag.isEmpty() ? (int) (ID_BASE + (at % 100000)) : (ID_BASE + Math.abs(tag.hashCode() % 100000));
        PendingIntent pi = PendingIntent.getActivity(ctx, id, tap,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        nm.notify(id, n);
    }
}
