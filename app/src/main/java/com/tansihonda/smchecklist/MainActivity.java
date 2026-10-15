package com.tansihonda.smchecklist;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.util.Locale;

/**
 * Tansi Honda – Sales Manager Checklist.
 * Native shell around the Google Apps Script web app:
 *  - full-screen, no browser bars, Android back button
 *  - "Take photo" opens the phone camera directly (live photo only)
 *  - GPS location given to the web app through the TansiApp bridge (works inside Google Sites too)
 *  - WhatsApp / phone links open the real WhatsApp / dialer
 *  - offline screen with Retry
 */
public class MainActivity extends Activity {

    private static final int REQ_CAMERA = 101;
    private static final int REQ_FILES = 102;
    private static final int REQ_PERMS = 103;
    private static final String PREFS = "tansi_sm";
    private static final String KEY_URL = "start_url";
    private static final int INK = 0xFF111214;
    private static final int RED = 0xFFCC0000;

    private FrameLayout root;
    private WebView web;
    private View splash;
    private View offline;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private LocationManager locationManager;
    private volatile Location lastLocation;
    private boolean pageLoadedOnce = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final LocationListener locationListener = new LocationListener() {
        @Override public void onLocationChanged(Location l) { keepBest(l); }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(INK);
        w.setNavigationBarColor(Color.WHITE);
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        root = new FrameLayout(this);
        root.setBackgroundColor(INK);
        setContentView(root);

        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        askLocationPermission();

        String url = startUrl();
        if (url.isEmpty()) {
            showSetup(null);
        } else {
            openApp(url, savedInstanceState);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        startLocation();
        if (web != null) web.onResume();
    }

    @Override protected void onPause() {
        super.onPause();
        stopLocation();
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        if (offline != null && offline.getVisibility() == View.VISIBLE && web != null) { super.onBackPressed(); return; }
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ------------------------------------------------------------------ app link (first launch)

    private String startUrl() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String saved = p.getString(KEY_URL, "");
        if (saved != null && !saved.isEmpty()) return saved;
        return BuildConfig.START_URL == null ? "" : BuildConfig.START_URL.trim();
    }

    private void showSetup(String message) {
        root.removeAllViews();
        LinearLayout box = column();
        box.setPadding(dp(28), dp(64), dp(28), dp(28));
        box.setBackgroundColor(INK);

        box.addView(mark());
        box.addView(brandBadge());
        TextView t = text("Sales Manager Checklist", 24, Color.WHITE, true);
        box.addView(t);
        TextView s = text(message != null ? message
                : "Paste the app link your admin shared (for example tinyurl.com/…). You need to do this only once.", 15, 0xFFBBBBC4, false);
        s.setPadding(0, dp(10), 0, dp(18));
        box.addView(s);

        final EditText input = new EditText(this);
        input.setHint("App link");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextColor(INK);
        input.setHintTextColor(0xFF888890);
        input.setPadding(dp(16), dp(14), dp(16), dp(14));
        input.setBackground(rounded(Color.WHITE, 14));
        input.setText(startUrl());
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button go = button("Open app", RED, Color.WHITE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(16);
        box.addView(go, lp);
        go.setOnClickListener(v -> {
            String u = input.getText().toString().trim();
            if (u.isEmpty()) { toast("Paste the app link first"); return; }
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
            if (u.startsWith("http://")) u = "https://" + u.substring(7);
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, u).apply();
            openApp(u, null);
        });
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // ------------------------------------------------------------------ web view

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void openApp(String url, Bundle state) {
        root.removeAllViews();
        if (web != null) { web.destroy(); }
        web = new WebView(this);
        web.setBackgroundColor(0xFFF3F3F5);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " TansiSMApp/" + BuildConfig.VERSION_NAME);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "TansiApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = buildSplash();
        root.addView(splash);
        offline = buildOffline();
        offline.setVisibility(View.GONE);
        root.addView(offline);

        pageLoadedOnce = false;
        if (state != null && web.restoreState(state) != null) {
            hideSplash();
        } else if (!isOnline()) {
            showOffline();
        } else {
            web.loadUrl(url);
        }
        // safety: never leave the splash up for ever
        ui.postDelayed(this::hideSplash, 15000);
    }

    private class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            return handleExternally(r.getUrl());
        }

        @Override public void onPageStarted(WebView v, String url, Bitmap favicon) {
            if (offline != null) offline.setVisibility(View.GONE);
        }

        @Override public void onPageFinished(WebView v, String url) {
            pageLoadedOnce = true;
            ui.postDelayed(MainActivity.this::hideSplash, 1200);
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) showOffline();
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                if (params.isCaptureEnabled()) openCamera();
                else openGallery();
                return true;
            } catch (Exception e) {
                fileCallback = null;
                toast("Could not open the camera / gallery");
                return false;
            }
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (hasLocationPermission()) {
                callback.invoke(origin, true, false);
            } else {
                geoOrigin = origin;
                geoCallback = callback;
                askLocationPermission();
            }
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // target=_blank / window.open (WhatsApp report, call): hand the link to Android
            final boolean[] handled = {false};
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                private void take(WebView p, String u) {
                    if (handled[0] || u == null || u.equals("about:blank")) return;
                    handled[0] = true;
                    openExternal(u);
                    p.stopLoading();
                    ui.post(p::destroy);
                }
                @Override public boolean shouldOverrideUrlLoading(WebView p, WebResourceRequest r) { take(p, r.getUrl().toString()); return true; }
                @Override public void onPageStarted(WebView p, String u, Bitmap f) { take(p, u); }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }

    /** Exposed to the web app as window.TansiApp (all frames, including the Apps Script frame). */
    private class Bridge {
        @JavascriptInterface public String getLocation() {
            Location l = lastLocation;
            if (l == null) return "";
            long ageMs = System.currentTimeMillis() - l.getTime();
            if (ageMs > 15 * 60 * 1000L) return "";
            return String.format(Locale.US, "{\"lat\":%.6f,\"lng\":%.6f,\"acc\":%.0f,\"t\":%d}",
                    l.getLatitude(), l.getLongitude(), l.getAccuracy(), l.getTime());
        }

        @JavascriptInterface public void openExternal(final String url) {
            ui.post(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface public void changeLink() {
            ui.post(() -> showSetup("Paste the new app link."));
        }
    }

    // ------------------------------------------------------------------ links

    private boolean handleExternally(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.US);
        if (scheme.equals("http") || scheme.equals("https")) {
            boolean outside = host.equals("wa.me") || host.endsWith("whatsapp.com") || host.equals("play.google.com")
                    || host.equals("maps.google.com") || (host.equals("www.google.com") && u.getPath() != null && u.getPath().startsWith("/maps"));
            if (!outside) return false;   // Google / Sites / short-link pages stay inside the app
        }
        openExternal(u.toString());
        return true;
    }

    private void openExternal(String url) {
        if (url == null) return;
        try {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
            Intent i;
            if (scheme.equals("tel")) i = new Intent(Intent.ACTION_DIAL, u);
            else if (scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto") || scheme.equals("whatsapp") || scheme.equals("geo"))
                i = new Intent(Intent.ACTION_VIEW, u);
            else return; // ignore anything else (no intent:// from web content)
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast("No app found to open this link");
        } catch (Exception e) {
            toast("Could not open the link");
        }
    }

    // ------------------------------------------------------------------ camera / gallery

    private void openCamera() throws Exception {
        File dir = new File(getCacheDir(), "photos");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("no dir");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 86400000L) //noinspection ResultOfMethodCallIgnored
            f.delete();
        cameraFile = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
        cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", cameraFile);
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(i, REQ_CAMERA);
    }

    private void openGallery() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("image/*");
        startActivityForResult(Intent.createChooser(i, "Choose photo / screenshot"), REQ_FILES);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (fileCallback == null) return;
        Uri[] result = null;
        if (requestCode == REQ_CAMERA) {
            if (resultCode == RESULT_OK && cameraFile != null && cameraFile.length() > 0) {
                //noinspection ResultOfMethodCallIgnored
                cameraFile.setLastModified(System.currentTimeMillis());
                result = new Uri[]{cameraUri};
            }
        } else if (requestCode == REQ_FILES) {
            result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    // ------------------------------------------------------------------ location

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void askLocationPermission() {
        if (hasLocationPermission()) return;
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERMS) return;
        boolean ok = hasLocationPermission();
        if (ok) startLocation();
        else toast("Location is off – photos will not show the branch location");
        if (geoCallback != null) { geoCallback.invoke(geoOrigin, ok, false); geoCallback = null; }
    }

    @SuppressLint("MissingPermission")
    private void startLocation() {
        if (locationManager == null || !hasLocationPermission()) return;
        try {
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                if (!locationManager.isProviderEnabled(p)) continue;
                keepBest(locationManager.getLastKnownLocation(p));
                locationManager.requestLocationUpdates(p, 30000L, 10f, locationListener, Looper.getMainLooper());
            }
        } catch (Exception ignored) { }
    }

    private void stopLocation() {
        try { if (locationManager != null) locationManager.removeUpdates(locationListener); } catch (Exception ignored) { }
    }

    private void keepBest(Location l) {
        if (l == null) return;
        Location cur = lastLocation;
        if (cur == null || l.getTime() > cur.getTime() + 60000L || (l.getTime() >= cur.getTime() - 60000L && l.getAccuracy() < cur.getAccuracy())) {
            lastLocation = l;
        }
    }

    // ------------------------------------------------------------------ splash / offline

    private View buildSplash() {
        LinearLayout box = column();
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(INK);
        box.addView(mark());
        box.addView(brandBadge());
        TextView t = text("Sales Manager Checklist", 18, Color.WHITE, true);
        t.setGravity(Gravity.CENTER);
        box.addView(t);
        ProgressBar pb = new ProgressBar(this);
        pb.getIndeterminateDrawable().setTint(RED);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(36), dp(36));
        lp.topMargin = dp(28);
        box.addView(pb, lp);
        box.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        box.setClickable(true);
        return box;
    }

    private void hideSplash() {
        if (splash == null || splash.getVisibility() != View.VISIBLE) return;
        splash.animate().alpha(0f).setDuration(250).withEndAction(() -> { if (splash != null) splash.setVisibility(View.GONE); }).start();
    }

    private View buildOffline() {
        LinearLayout box = column();
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(0xFFF3F3F5);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        TextView t = text("No internet connection", 20, INK, true);
        t.setGravity(Gravity.CENTER);
        box.addView(t);
        TextView s = text("Check mobile data or Wi-Fi and try again. Nothing you saved is lost.", 15, 0xFF60606A, false);
        s.setGravity(Gravity.CENTER);
        s.setPadding(0, dp(8), 0, dp(20));
        box.addView(s);
        Button retry = button("Retry", RED, Color.WHITE);
        box.addView(retry, new LinearLayout.LayoutParams(dp(200), dp(50)));
        retry.setOnClickListener(v -> {
            if (!isOnline()) { toast("Still offline"); return; }
            offline.setVisibility(View.GONE);
            if (pageLoadedOnce && web.getUrl() != null) web.reload(); else web.loadUrl(startUrl());
        });
        TextView change = text("Change app link", 14, RED, false);
        change.setPadding(dp(12), dp(24), dp(12), dp(12));
        change.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setTitle("Change app link?")
                .setMessage("Only do this if your admin gave you a new link.")
                .setPositiveButton("Change", (d, x) -> showSetup("Paste the new app link."))
                .setNegativeButton("Cancel", null).show());
        box.addView(change);
        box.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        box.setClickable(true);
        return box;
    }

    private void showOffline() {
        if (offline == null) return;
        hideSplash();
        offline.setVisibility(View.VISIBLE);
    }

    private boolean isOnline() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return true;
        }
    }

    // ------------------------------------------------------------------ small UI helpers

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private View mark() {
        ImageView iv = new ImageView(this);
        iv.setImageResource(R.drawable.ic_mark);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(76), dp(76));
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        lp.bottomMargin = dp(18);
        iv.setLayoutParams(lp);
        return iv;
    }

    private View brandBadge() {
        TextView b = text("TANSI HONDA", 13, Color.WHITE, true);
        b.setLetterSpacing(0.22f);
        b.setBackground(rounded(RED, 6));
        b.setPadding(dp(10), dp(4), dp(10), dp(4));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        lp.bottomMargin = dp(10);
        b.setLayoutParams(lp);
        return b;
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return t;
    }

    private Button button(String label, int bg, int fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTextColor(fg);
        b.setBackground(rounded(bg, 26));
        b.setStateListAnimator(null);
        return b;
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void toast(String m) {
        Toast.makeText(this, m, Toast.LENGTH_SHORT).show();
    }
}
