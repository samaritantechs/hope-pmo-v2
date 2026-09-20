package com.samaritantechs.hopecalls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * "can we track were they are by the devices without lockapp ... it's a few cars with car
 * tracks so if the apps could handle following were they are is a positive thing" -- officers
 * who do not carry the separate device-lock app, but who allow location, are followed the same
 * way a locked handset already is: a beat every few minutes, landing on the same access_codes
 * row that officerLocationsList (Settings) reads.
 *
 * Plain android.location.LocationManager, not a Play Services FusedLocationProviderClient --
 * this project carries no Play Services dependency anywhere and one screen's location feature
 * is not worth starting one. Posts straight to the same /api/portal { code, fn: 'officerBeat' }
 * this app's own web side calls, with HttpURLConnection -- there is no other networking library
 * in this codebase either.
 *
 * Runs ONLY while an officer is signed in -- started and stopped by
 * MainActivity.startOrStopLocationService_, itself driven by HopeCallsBridge.setOfficerCode,
 * itself called from app.html at sign-in, sign-out and code change. Nothing here decides on its
 * own to start tracking somebody.
 *
 * A foreground service (the persistent notification this posts) is the ONLY way a plain
 * LocationManager keeps delivering fixes once the app is off screen -- without one, Android
 * itself stops the callbacks within minutes, silently, no crash. Whether it keeps working while
 * the app is in the background a second layer down -- truly backgrounded, not just off screen --
 * additionally depends on ACCESS_BACKGROUND_LOCATION being granted; without it Android simply
 * stops delivering fixes the moment the app leaves the foreground, and resumes the moment it is
 * granted or the app is reopened. Both are safe, silent degradations this class does not need to
 * detect or react to itself.
 */
public class OfficerLocationService extends Service implements LocationListener {
    private static final String CHANNEL_ID = "officer_location";
    private static final int NOTIF_ID = 4471;
    // "were they are" only needs to be roughly current, not live-tracked to the second -- once
    // every five minutes (or sooner, once they have actually moved 50m) is a fix a supervisor
    // can act on without asking a phone that is mostly sitting in a pocket to burn its battery
    // reporting a position that has not changed.
    private static final long MIN_TIME_MS = 5 * 60 * 1000L;
    private static final float MIN_DISTANCE_M = 50f;

    private HandlerThread thread;
    private LocationManager lm;
    private SharedPreferences prefs;

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("hopecalls", MODE_PRIVATE);
        startForeground(NOTIF_ID, buildNotification_());
        thread = new HandlerThread("officer-location");
        thread.start();
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        requestUpdates_();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // If the OS kills this process under memory pressure, restart it (null intent) rather
        // than leaving tracking silently off until the app is next opened by hand.
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        try { if (lm != null) lm.removeUpdates(this); } catch (SecurityException ignored) {}
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    private void requestUpdates_() {
        boolean fine = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) { stopSelf(); return; }   // nothing to track with -- do not sit in the tray for nothing
        Looper looper = thread.getLooper();
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DISTANCE_M, this, looper);
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, MIN_TIME_MS, MIN_DISTANCE_M, this, looper);
            }
        } catch (SecurityException ignored) {
            // permission pulled out from under a running service -- nothing here can force the
            // dialog back open; the next sign-in retries via startOrStopLocationService_.
        }
    }

    @Override
    public void onLocationChanged(Location loc) { beat_(loc); }

    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}

    private void beat_(Location loc) {
        final String code = prefs.getString("officerCode", "");
        if (code.isEmpty()) { stopSelf(); return; }   // signed out from underneath a running beat
        final String base = MainActivity.resolveStartUrl(prefs);
        final double lat = loc.getLatitude(), lng = loc.getLongitude();
        final boolean hasAcc = loc.hasAccuracy();
        final float acc = loc.getAccuracy();
        final long at = loc.getTime();
        new Thread(() -> {
            try {
                JSONObject args = new JSONObject();
                args.put("lat", lat);
                args.put("lng", lng);
                if (hasAcc) args.put("locAcc", acc);
                args.put("locAt", at);
                JSONObject body = new JSONObject();
                body.put("code", code);
                body.put("fn", "officerBeat");
                body.put("args", args);

                URL url = new URL(base.replaceAll("/+$", "") + "/api/portal");
                HttpURLConnection c = (HttpURLConnection) url.openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.setDoOutput(true);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                c.getResponseCode();   // drain the response -- this beat is fire-and-forget either way
                c.disconnect();
            } catch (Exception ignored) {
                // one missed beat is nothing -- the next fix, minutes away, tries again
            }
        }).start();
    }

    private Notification buildNotification_() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Mahali / Location",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Inaripoti mahali pa kifaa cha kampuni / Reports this company device's location.");
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Intent tap = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, tap,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("HOPE PMO")
                .setContentText("Inaripoti mahali pa kifaa / Reporting device location")
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
    }
}
