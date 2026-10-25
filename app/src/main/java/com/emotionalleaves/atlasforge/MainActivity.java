package com.emotionalleaves.atlasforge;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Hosts the Atlas Forge web app (assets/www) in a full-screen WebView. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.local";
    private static final int PICK_FILE = 41;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    // map tiles the user has looked at are kept on the device so those areas still show offline
    private static final Set<String> TILE_HOSTS = new HashSet<>(Arrays.asList(
            "server.arcgisonline.com", "services.arcgisonline.com", "tile.openstreetmap.org", "tile.opentopomap.org"));
    private static final long TILE_CACHE_MAX = 1500L * 1024 * 1024;
    private File tileDir;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tileDir = new File(getFilesDir(), "tiles");
        new Thread(this::pruneTiles).start();
        web = new WebView(this);
        web.setBackgroundColor(0xFF0E131B);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url.getHost() != null && TILE_HOSTS.contains(url.getHost()) && "GET".equals(request.getMethod())) return tile(url);
                if (!HOST.equals(url.getHost())) return null;
                String path = url.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                String mime = mimeOf(path);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("Access-Control-Allow-Origin", "*");
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mime, mime.startsWith("text") || mime.endsWith("json") || mime.endsWith("javascript") ? "utf-8" : null, 200, "OK", headers, in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Open an Atlas Forge world"), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("AtlasForge", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.loadUrl("https://" + HOST + "/index.html");
    }

    // ---- tile cache ----
    private static String keyOf(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder b = new StringBuilder(); for (byte x : d) b.append(String.format("%02x", x)); return b.toString();
        } catch (Exception e) { return Integer.toHexString(s.hashCode()); }
    }
    private static String imageMime(byte[] head) {
        if (head.length > 3 && (head[0] & 0xff) == 0x89 && head[1] == 'P') return "image/png";
        if (head.length > 2 && (head[0] & 0xff) == 0xff && (head[1] & 0xff) == 0xd8) return "image/jpeg";
        if (head.length > 11 && head[8] == 'W' && head[9] == 'E') return "image/webp";
        return "image/png";
    }
    private WebResourceResponse tile(Uri url) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        String key = keyOf(url.toString());
        File f = new File(new File(tileDir, key.substring(0, 2)), key);
        try {
            if (f.length() > 0) {
                byte[] head = new byte[12];
                try (FileInputStream in = new FileInputStream(f)) { in.read(head); }
                if (System.currentTimeMillis() - f.lastModified() > 86400000L) f.setLastModified(System.currentTimeMillis());
                return new WebResourceResponse(imageMime(head), null, 200, "OK", h, new FileInputStream(f));
            }
            HttpURLConnection c = (HttpURLConnection) new URL(url.toString()).openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent", "AtlasForge/1.0 (Android map app; github.com/EmotionalLeaves/atlas---forge)");
            int code = c.getResponseCode();
            if (code != 200) { c.disconnect(); return new WebResourceResponse("text/plain", "utf-8", code, "Error", h, new ByteArrayInputStream(new byte[0])); }
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) { byte[] buf = new byte[16384]; int n; while ((n = in.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > 4 * 1024 * 1024) break; } }
            c.disconnect();
            byte[] data = bo.toByteArray();
            try {
                File dir = f.getParentFile(); if (dir != null && !dir.exists()) dir.mkdirs();
                File tmp = new File(f.getPath() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data); }
                if (!tmp.renameTo(f)) tmp.delete();
            } catch (IOException ignored) { }
            return new WebResourceResponse(imageMime(data), null, 200, "OK", h, new ByteArrayInputStream(data));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 504, "Offline", h, new ByteArrayInputStream(new byte[0]));
        }
    }
    private long[] tileStats(List<File> collect) {
        long n = 0, bytes = 0; File[] dirs = tileDir.listFiles();
        if (dirs != null) for (File d : dirs) { File[] fs = d.listFiles(); if (fs == null) continue; for (File x : fs) { n++; bytes += x.length(); if (collect != null) collect.add(x); } }
        return new long[] { n, bytes };
    }
    /** Keep the tile cache under its size limit (least recently used tiles go first). */
    private void pruneTiles() {
        try {
            List<File> all = new ArrayList<>(); long[] st = tileStats(all);
            if (st[1] <= TILE_CACHE_MAX) return;
            all.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            long bytes = st[1];
            for (File x : all) { if (bytes <= TILE_CACHE_MAX * 8 / 10) break; bytes -= x.length(); x.delete(); }
        } catch (Exception e) { Log.w("AtlasForge", "prune failed", e); }
    }
    private static void deleteTree(File f) { File[] k = f.listFiles(); if (k != null) for (File x : k) deleteTree(x); f.delete(); }

    private static String mimeOf(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.atlasBack ? window.atlasBack() : false)", value -> {
            if (!"true".equals(value)) super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        if (web != null) web.evaluateJavascript("window.app && window.app.W && import('./js/app.js').then(m => m.autosave())", null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Lets the web app save files (world exports, CSVs) into Downloads/AtlasForge, and share text. */
    private class Bridge {
        @JavascriptInterface
        public void shareText(String subject, String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, subject);
                i.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(i, "Share plan")); } catch (ActivityNotFoundException ignored) { }
            });
        }

        @JavascriptInterface
        public String tileCacheInfo() {
            long[] st = tileStats(null);
            return "{\"files\":" + st[0] + ",\"bytes\":" + st[1] + ",\"max\":" + TILE_CACHE_MAX + "}";
        }

        @JavascriptInterface
        public void clearTileCache() { deleteTree(tileDir); }

        @JavascriptInterface
        public String clipboardText() {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip().getItemCount() == 0) return "";
            CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
            return t == null ? "" : t.toString();
        }

        @JavascriptInterface
        public String saveFile(String name, String base64, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AtlasForge");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return "";
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) return "";
                    os.write(bytes);
                }
                String saved = name;
                try (Cursor c = getContentResolver().query(uri, new String[] { MediaStore.Downloads.DISPLAY_NAME }, null, null, null)) {
                    if (c != null && c.moveToFirst()) saved = c.getString(0);
                } catch (Exception ignored) { }
                return "Downloads/AtlasForge/" + saved;
            } catch (Exception e) {
                Log.e("AtlasForge", "saveFile failed", e);
                return "";
            }
        }
    }
}
