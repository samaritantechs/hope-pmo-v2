package com.samaritantechs.hopecalls;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * HOPE Calls: a WebView around the portal's /call page, plus the one thing a browser cannot
 * do -- read the device call log so officers' calls sync automatically. The page detects the
 * {@code HopeCalls} JS interface and lights up sync; in a plain browser the same page still
 * works for dialing and follow-ups, so this app carries NO business logic of its own and
 * never needs an update when the page changes.
 */
public class MainActivity extends Activity {
    private static final int REQ_CALL_LOG = 71;
    private WebView web;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("hopecalls", MODE_PRIVATE);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage holds the device id + list cache
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.addJavascriptInterface(new HopeCallsBridge(this, prefs), "HopeCalls");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("tel".equals(u.getScheme())) {
                    // ACTION_DIAL opens the dialer with the number filled in -- no CALL_PHONE
                    // permission needed, and the officer always presses the green button themselves.
                    startActivity(new Intent(Intent.ACTION_DIAL, u));
                    return true;
                }
                return false;                   // keep the portal itself inside the app
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showUrlScreen(String.valueOf(err.getDescription()));
            }
        });

        if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG}, REQ_CALL_LOG);
        }
        web.loadUrl(startUrl());
    }

    private String startUrl() {
        return prefs.getString("startUrl", BuildConfig.START_URL);
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
                + "<h2 style='margin:0 0 6px'>HOPE Calls</h2>"
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

    void retryFromBridge() {
        runOnUiThread(() -> web.loadUrl(startUrl()));
    }

    void setStartUrlFromBridge(String url) {
        String u = url == null ? "" : url.trim();
        if (!u.startsWith("http")) u = "https://" + u;
        prefs.edit().putString("startUrl", u).apply();
        final String go = u;
        runOnUiThread(() -> web.loadUrl(go));
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
        super.onRequestPermissionsResult(code, perms, grants);
        // The page checks hasCallLogPermission() on every sync -- reload so its banner updates now.
        if (code == REQ_CALL_LOG) web.reload();
    }
}
