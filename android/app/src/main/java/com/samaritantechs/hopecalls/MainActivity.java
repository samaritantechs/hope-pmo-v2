package com.samaritantechs.hopecalls;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * HOPE PMO in one app: a WebView around the portal launcher, so a leader signs in once and
 * chooses Calls or the system (dashboard, uploads) from the same place -- plus the two things
 * a plain browser tab cannot do here:
 *   1. read the device call log, so officers' calls sync automatically (HopeCallsBridge);
 *   2. hand a real file picker to the page's &lt;input type=file&gt;, which is DEAD in a WebView
 *      unless the host app implements onShowFileChooser -- that is what makes uploading the
 *      daily Expected/Defaulters workbook from the phone work at all.
 * The app carries no business logic, so the pages can change without shipping a new APK.
 */
public class MainActivity extends Activity {
    /** One combined runtime-permission ask (call log + location) so the two dialogs never race
        each other -- Android does not guarantee a second requestPermissions() queues cleanly
        behind a first that is still on screen. */
    private static final int REQ_PERMS = 71;
    private static final int REQ_FILE_PICK = 72;

    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> pendingFileCallback;
    // The page's getCurrentPosition() call is answered async, once the OS permission dialog
    // (if any) resolves -- see onGeolocationPermissionsShowPrompt / onRequestPermissionsResult.
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("hopecalls", MODE_PRIVATE);

        web = new WebView(this);
        // Leave the phone's own status bar (clock, battery, signal) visible and untouched:
        // without this the page draws underneath it, so the time and battery sit on top of
        // the app's header. fitsSystemWindows insets the WebView below the system bars.
        web.setFitsSystemWindows(true);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage holds the access code, device id, list cache
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);           // the page never needs file:// -- keep it shut
        s.setGeolocationEnabled(true);         // required or the page's GPS capture buttons fail silently, permission or not
        web.addJavascriptInterface(new HopeCallsBridge(this, prefs), "HopeCalls");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if ("tel".equals(scheme)) {
                    // ACTION_DIAL opens the dialer with the number filled in -- no CALL_PHONE
                    // permission needed, and the officer always presses the green button themselves.
                    startActivity(new Intent(Intent.ACTION_DIAL, u));
                    return true;
                }
                if ("mailto".equals(scheme) || "sms".equals(scheme) || "whatsapp".equals(scheme)) {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                    return true;
                }
                /* ONLY OUR OWN SERVER MAY LOAD IN HERE, because this WebView carries the
                 * bridge -- and on Android a @JavascriptInterface is offered to WHATEVER page
                 * the WebView is showing, not just the one that was loaded first. Any other
                 * site reached from a link would therefore be able to call HopeCalls.getCalls()
                 * and read the officer's call log, HopeCalls.getDeviceId(), and
                 * HopeCalls.setStartUrl() to point this app permanently at a server of its own.
                 *
                 * The configured host is read from startUrl(), not from a constant, so the
                 * built-in "save a different server" screen keeps working exactly as before: it
                 * writes the new URL to preferences BEFORE loading it, so by the time this runs
                 * the new server IS the configured one. A changed domain still never bricks an
                 * installed app and still never needs an APK rebuild.
                 *
                 * Anything else opens in the phone's browser, where there is no bridge. */
                String host = u.getHost() == null ? "" : u.getHost();
                Uri mine = Uri.parse(startUrl());
                String mineHost = mine.getHost() == null ? "" : mine.getHost();
                if (!mineHost.isEmpty() && !mineHost.equalsIgnoreCase(host)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
                    catch (Exception ignored) { /* no browser -- refusing to load it is still right */ }
                    return true;
                }
                return false;                   // our own portal stays inside the app
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showUrlScreen(String.valueOf(err.getDescription()));
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                try {
                    // params.createIntent() honours the page's own accept="" list (.xlsx/.xls/.csv).
                    startActivityForResult(params.createIntent(), REQ_FILE_PICK);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    Toast.makeText(MainActivity.this, "Hakuna programu ya kuchagua faili.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }

            /* "geolocation still an issue and app never asked permission for that" -- true: a
               bare WebView denies every geolocation request with NO prompt at all unless this
               callback is implemented. There is no ACTIVITY dialog here to show -- the OS
               permission is asked once up front in onCreate (every launch, not just the first),
               so by the time a page button fires this we normally already know the answer. On
               the rare case a user answers the OS dialog only after this fires, park the
               WebView callback and resolve it from onRequestPermissionsResult instead of
               guessing "no". */
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) { callback.invoke(origin, true, false); return; }
                pendingGeoCallback = callback;
                pendingGeoOrigin = origin;
                showLocationRationale_(
                        () -> requestPermissions(
                                new String[]{ Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION },
                                REQ_PERMS),
                        // Baadaye/Later or a cancel -- answer the page's callback "no" rather than
                        // leaving its "Finding location..." button spinning forever with no reply.
                        () -> {
                            if (pendingGeoCallback != null) {
                                pendingGeoCallback.invoke(pendingGeoOrigin, false, false);
                                pendingGeoCallback = null;
                                pendingGeoOrigin = null;
                            }
                        });
            }

            @Override
            public void onGeolocationPermissionsHidePrompt() {
                pendingGeoCallback = null;
                pendingGeoOrigin = null;
            }
        });

        // Reports the page offers for download go to the phone's Downloads folder via the
        // system DownloadManager, so they can be re-opened (or re-uploaded) like any file.
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long size) {
                /* NEVER HAND DownloadManager A blob: OR data: URL. It does not understand
                   either, it throws, and the catch below then asks Android to open that same URL
                   with an ordinary app -- which nothing can, so the app closes with no file and
                   no message. That is the "downloading JPG just closes the app" report.
                   The page saves those itself through HopeCalls.saveBase64; if one reaches here
                   at all it is from an older page, and saying so beats dying. */
                if (url != null && (url.startsWith("blob:") || url.startsWith("data:"))) {
                    Toast.makeText(MainActivity.this,
                            "Fungua mfumo kwenye Chrome kupakua faili hii / open the system in Chrome to save this file",
                            Toast.LENGTH_LONG).show();
                    return;
                }
                try {
                    String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    r.setMimeType(mimeType);
                    r.addRequestHeader("User-Agent", userAgent);
                    r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(r);
                    Toast.makeText(MainActivity.this, "Inapakua: " + name, Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));   // let the browser have it
                }
            }
        });

        // "those who denied any permission, always prompt them to allow whenever they open app"
        // -- this runs on every onCreate, i.e. every launch, not only the first. Android itself
        // stops showing the dialog once a user has picked "Don't ask again"; short of that, this
        // re-asks every time rather than making them dig through Settings.
        requestMissingPermissions();
        web.loadUrl(startUrl());
        // Ask the portal whether a newer build exists. Off the UI thread, failures ignored --
        // an update check must never be the reason the app does not open.
        Updater.checkInBackground(this, startUrl());
    }

    /**
     * The saved override MUST NOT outlive the build that it was saved against. An install that
     * once pointed itself at ".../call" (via the fallback screen, back when that was the app's
     * whole job) kept loading the calls page straight after updating -- the launcher was in the
     * APK but unreachable, so signing in appeared to "go directly to calls". An override is now
     * stamped with the versionCode that saved it and is dropped when the app moves on; a stale
     * ".../call" is additionally rewritten to the site root rather than simply discarded, so a
     * genuinely different domain typed in the field survives the upgrade.
     */
    private String startUrl() {
        String saved = prefs.getString("startUrl", null);
        if (saved == null) return BuildConfig.START_URL;
        if (prefs.getInt("startUrlVersion", 0) >= BuildConfig.VERSION_CODE) return saved;
        String migrated = saved.replaceAll("/call/?$", "/");
        prefs.edit().putString("startUrl", migrated)
                    .putInt("startUrlVersion", BuildConfig.VERSION_CODE).apply();
        return migrated;
    }

    /**
     * Offline / wrong-server fallback: a tiny built-in page (no network needed) that retries,
     * or saves a different server URL to preferences -- so a changed domain never bricks the
     * installed app and never requires an APK rebuild in the field.
     */
    private void showUrlScreen(String why) {
        String current = startUrl();
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='font-family:sans-serif;background:#0B2A6B;color:#fff;padding:28px'>"
                + "<h2 style='margin:0 0 6px'>HOPE LOAN</h2>"
                + "<p style='color:#93C5FD'>Imeshindikana kufungua mfumo. Angalia mtandao wako, kisha jaribu tena.<br>"
                + "<small>" + android.text.TextUtils.htmlEncode(why == null ? "" : why) + "</small></p>"
                + "<button onclick='HopeCalls.retry()' style='width:100%;padding:14px;border:0;border-radius:10px;font-weight:700'>Jaribu tena / Retry</button>"
                + "<p style='color:#93C5FD;margin-top:26px'>Kama mfumo umehamia anwani mpya, iweke hapa:</p>"
                + "<input id=u value='" + android.text.TextUtils.htmlEncode(current) + "' style='width:100%;padding:12px;border-radius:10px;border:0'>"
                + "<button onclick='HopeCalls.setStartUrl(document.getElementById(\"u\").value)' "
                + "style='width:100%;padding:14px;border:0;border-radius:10px;font-weight:700;margin-top:10px'>Hifadhi &amp; fungua / Save &amp; open</button>"
                + "</body>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Asks for whichever of {call log, location} is not already granted, in one dialog queue.
        "use friendly note that an officer will adhere to allowing" -- the bare OS dialog names
        a permission, not a reason, and a reason is what makes someone tap Allow instead of the
        reflex Deny. When location is the one missing, a short rationale explains why BEFORE
        Android's own dialog appears; call log alone (nothing new to explain) skips straight to
        it, as it always has. */
    private void requestMissingPermissions() {
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.READ_CALL_LOG);
        }
        boolean needsLocation = !hasLocationPermission();
        if (needsLocation) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
            need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (need.isEmpty()) return;
        String[] perms = need.toArray(new String[0]);
        if (needsLocation) showLocationRationale_(() -> requestPermissions(perms, REQ_PERMS), null);
        else requestPermissions(perms, REQ_PERMS);
    }

    /** "tell 'Allow report auto-updates whenever the background is updated'" -- final wording, and
        "dont even mention gps" -- neither the title nor the message names location/GPS at
        all, in Swahili or English, on purpose. Not a forced dialog either -- Baadaye/Later
        dismisses it like every other friendly prompt in this app (the battery one included):
        a note that can only be escaped by agreeing is not a friendly note.
        "when someone hit later even when they reoopen next minutes it comes again" -- nothing
        here is remembered on Later or on cancel; requestMissingPermissions() runs fresh on
        every onCreate with no flag saved anywhere, so the very next launch asks again exactly
        the same way, however soon that is. onDecline lets the caller answer anything left
        waiting on this (a GPS button's own callback) rather than leaving it hanging -- pass
        null where there is nothing to answer. */
    private void showLocationRationale_(Runnable thenRequest, Runnable onDecline) {
        new AlertDialog.Builder(this)
                .setTitle("Ruhusu Taarifa Kuupdate / Allow Updates")
                .setMessage("Ruhusu taarifa kuupdate zenyewe kila zinapobadilika. / "
                        + "Allow report auto-updates whenever the background is updated.")
                .setCancelable(true)
                .setOnCancelListener(d -> { if (onDecline != null) onDecline.run(); })
                .setNegativeButton("Baadaye / Later", (d, w) -> { if (onDecline != null) onDecline.run(); })
                .setPositiveButton("Endelea / Continue", (d, w) -> thenRequest.run())
                .show();
    }

    void retryFromBridge() {
        runOnUiThread(() -> web.loadUrl(startUrl()));
    }

    void setStartUrlFromBridge(String url) {
        String u = url == null ? "" : url.trim();
        /* A REAL http(s) ADDRESS, OR NOTHING. `startsWith("http")` also accepted "httpfoo:" and
         * anything else beginning with those four letters, and this value is PERSISTED as the
         * server every future launch loads. It decides where an officer's registration and
         * their customers' details are sent, so it is worth being exact about. */
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
        Uri parsed = Uri.parse(u);
        if (parsed.getHost() == null || parsed.getHost().isEmpty()) return;   // not an address
        prefs.edit().putString("startUrl", u).putInt("startUrlVersion", BuildConfig.VERSION_CODE).apply();
        final String go = u;
        runOnUiThread(() -> web.loadUrl(go));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_PICK) {
            // The callback MUST be answered even on cancel, or the page's file input stays
            // permanently stuck and no further pick is possible until a reload.
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingFileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
        super.onRequestPermissionsResult(code, perms, grants);
        if (code != REQ_PERMS) return;
        // The page checks hasCallLogPermission() on every sync -- reload so its banner updates now.
        web.reload();
        // If a GPS capture button is what triggered this ask, answer it now instead of leaving
        // the page's "Finding location..." button spinning forever.
        if (pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, hasLocationPermission(), false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }
}
