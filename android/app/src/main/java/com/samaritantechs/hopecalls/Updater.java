package com.samaritantechs.hopecalls;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Self-update. Officers cannot be asked to sideload a new APK by hand every time the system
 * changes, so on each launch the app asks the portal what the current build is
 * (/api/app-version, served from the same app-version.json that stamped this APK's own
 * versionCode) and, when it is behind, downloads and offers to install it.
 *
 * Deliberately conservative: it never installs silently. Android would not allow that for a
 * sideloaded app anyway, and a surprise install mid-call would be worse than a tap.
 */
class Updater {
    private static final String PREF_SKIPPED = "skippedVersion";

    static void checkInBackground(final MainActivity activity, final String baseUrl) {
        new Thread(() -> {
            try {
                JSONObject j = fetch(baseUrl.replaceAll("/+$", "") + "/api/app-version");
                if (j == null) return;
                final int remote = j.optInt("versionCode", 0);
                if (remote <= BuildConfig.VERSION_CODE) return;              // already current
                final String url = j.optString("apkUrl", "");
                final String notes = j.optString("notes", "");
                final String name = j.optString("versionName", String.valueOf(remote));
                if (url.isEmpty()) return;
                // "Later" is remembered per version, so the prompt does not nag on every launch
                // for a build the user has already declined -- but a NEWER build still asks.
                int skipped = activity.getSharedPreferences("hopecalls", Context.MODE_PRIVATE).getInt(PREF_SKIPPED, 0);
                if (skipped == remote) return;
                activity.runOnUiThread(() -> prompt(activity, remote, name, notes, url));
            } catch (Exception ignored) {
                // An update check must never break the app: no network, bad JSON, anything -> skip.
            }
        }).start();
    }

    private static JSONObject fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        try {
            if (c.getResponseCode() != 200) return null;
            BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            return new JSONObject(sb.toString());
        } finally {
            c.disconnect();
        }
    }

    private static void prompt(final MainActivity activity, final int versionCode,
                               String versionName, String notes, final String url) {
        new AlertDialog.Builder(activity)
                .setTitle("Toleo jipya / Update available")
                .setMessage("HOPE PMO " + versionName + "\n\n" + notes)
                .setCancelable(false)
                .setPositiveButton("Sasisha / Update", (d, w) -> download(activity, url))
                .setNegativeButton("Baadaye / Later", (d, w) ->
                        activity.getSharedPreferences("hopecalls", Context.MODE_PRIVATE)
                                .edit().putInt(PREF_SKIPPED, versionCode).apply())
                .show();
    }

    private static void download(final MainActivity activity, String url) {
        try {
            final File out = new File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "HOPE-PMO-update.apk");
            if (out.exists() && !out.delete()) { /* stale copy stays -- the fresh download overwrites it below */ }
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle("HOPE PMO");
            r.setDescription("Inapakua toleo jipya…");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            r.setDestinationUri(Uri.fromFile(out));
            r.setMimeType("application/vnd.android.package-archive");
            DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            final long id = dm.enqueue(r);
            Toast.makeText(activity, "Inapakua toleo jipya…", Toast.LENGTH_SHORT).show();

            activity.registerReceiver(new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                    try { ctx.unregisterReceiver(this); } catch (Exception ignored) {}
                    if (!succeeded(dm, id)) {
                        Toast.makeText(activity, "Upakuaji umeshindikana.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    install(activity, out);
                }
            }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
               Build.VERSION.SDK_INT >= 33 ? Context.RECEIVER_EXPORTED : 0);
        } catch (Exception e) {
            // Last resort: hand the URL to the browser so the officer can still get the file.
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        }
    }

    private static boolean succeeded(DownloadManager dm, long id) {
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
            return c != null && c.moveToFirst()
                    && c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL;
        } catch (Exception e) {
            return false;
        }
    }

    /** A file:// URI would throw FileUriExposedException on modern Android -- the installer
        gets a content:// URI from our FileProvider plus a one-shot read grant instead. */
    private static void install(Activity activity, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
        } catch (Exception e) {
            Toast.makeText(activity, "Fungua faili HOPE-PMO-update.apk kwenye Downloads ili kusakinisha.", Toast.LENGTH_LONG).show();
        }
    }
}
