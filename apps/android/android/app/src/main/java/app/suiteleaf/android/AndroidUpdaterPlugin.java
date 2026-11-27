package app.suiteleaf.android;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;

/**
 * In-app Android updater for SuiteLeaf, mirroring SuiteMail's updater model:
 * checks GitHub Releases on startup / periodically (4h) / manually in Settings,
 * downloads the verified APK, verifies package name + versionCode + signing certificates,
 * requests unknown-sources install permission if needed, and launches the system installer.
 */
@CapacitorPlugin(name = "AndroidUpdater")
public class AndroidUpdaterPlugin extends Plugin {
    private static final long FOUR_HOURS = 4 * 60 * 60 * 1000L;
    private static final long MAX_APK_BYTES = 512 * 1024 * 1024L;
    private static final String RELEASES_URL =
            "https://api.github.com/repos/"
                    + AndroidUpdateRelease.REPO_OWNER
                    + "/"
                    + AndroidUpdateRelease.REPO_NAME
                    + "/releases?per_page=100&page=";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean checking = new AtomicBoolean();
    private final AtomicBoolean installing = new AtomicBoolean();
    private volatile boolean foreground = true;
    private volatile AndroidUpdateRelease available;
    private File ready;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("android-updater", 0);
    }

    private File cache() {
        File dir = new File(getContext().getCacheDir(), "updates");
        dir.mkdirs();
        return dir;
    }

    @Override
    public void load() {
        // Cached APKs never outlive a process; they are downloaded and verified again before use.
        File[] files = cache().listFiles();
        if (files != null) {
            for (File file : files) {
                file.delete();
            }
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        foreground = false;
    }

    @PluginMethod
    public void check(PluginCall call) {
        if (!checking.compareAndSet(false, true)) {
            call.reject("An update check is already running.");
            return;
        }
        executor.execute(() -> {
            try {
                long now = System.currentTimeMillis();
                long due = prefs().getLong("next_check", 0);
                if (now < prefs().getLong("rate_limit_until", 0)) {
                    throw new Exception("GitHub rate limit reached. Try again later.");
                }
                boolean manual = Boolean.TRUE.equals(call.getBoolean("manual", false));
                boolean startup = Boolean.TRUE.equals(call.getBoolean("startup", false));
                if (manual || startup || (foreground && now >= due)) {
                    prefs().edit().putLong("next_check", now + FOUR_HOURS).apply();
                    long installed = code(installed());
                    AndroidUpdateRelease candidate = null;
                    for (int page = 1; page <= 10; page++) {
                        HttpURLConnection connection = connect(RELEASES_URL + page);
                        JSONArray releases;
                        try (InputStream input = connection.getInputStream()) {
                            releases = new JSONArray(
                                    new String(readLimited(input, 10 * 1024 * 1024), StandardCharsets.UTF_8));
                        } finally {
                            connection.disconnect();
                        }
                        candidate = AndroidUpdateRelease.select(releases, installed, candidate);
                        if (releases.length() < 100) break;
                    }
                    available = candidate;
                }
                JSObject result = new JSObject();
                if (available == null) {
                    result.put("value", org.json.JSONObject.NULL);
                } else {
                    JSObject value = new JSObject();
                    value.put("version", available.version);
                    value.put("body", available.body);
                    result.put("value", value);
                }
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Cannot check for updates: " + e.getMessage(), e);
            } finally {
                checking.set(false);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        AndroidUpdateRelease update = available;
        if (update == null) {
            call.reject("Check for an update first.");
            return;
        }
        if (!installing.compareAndSet(false, true)) {
            call.reject("An update is already being installed.");
            return;
        }
        executor.execute(() -> {
            File partial = new File(cache(), "update.part");
            File apk = new File(cache(), "update.apk");
            try {
                HttpURLConnection connection = connect(update.url);
                try (InputStream input = connection.getInputStream();
                        FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_APK_BYTES) throw new Exception("APK download is too large.");
                        output.write(buffer, 0, count);
                    }
                    if (connection.getContentLengthLong() >= 0 && total != connection.getContentLengthLong()) {
                        throw new Exception("APK download was interrupted.");
                    }
                } finally {
                    connection.disconnect();
                }
                verify(partial, update.code);
                if (apk.exists() && !apk.delete()) throw new Exception("Cannot replace cached update.");
                if (!partial.renameTo(apk)) throw new Exception("Cannot save downloaded update.");
                ready = apk;
                getActivity().runOnUiThread(() -> {
                    try {
                        requestInstall(call);
                    } catch (Exception e) {
                        finish(call, e);
                    }
                });
            } catch (Exception e) {
                partial.delete();
                apk.delete();
                finish(call, e);
            }
        });
    }

    private void requestInstall(PluginCall call) throws Exception {
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, settings, "installPermissionResult");
        } else {
            launchInstaller(call);
        }
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            installing.set(false);
            return;
        }
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            finish(call, new Exception("Allow SuiteLeaf to install apps from this source, then tap Update again."));
            return;
        }
        try {
            launchInstaller(call);
        } catch (Exception e) {
            finish(call, e);
        }
    }

    private void launchInstaller(PluginCall call) throws Exception {
        if (ready == null || !ready.isFile()) {
            throw new Exception("Downloaded update is missing. Try again.");
        }
        Uri uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", ready);
        Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .putExtra(Intent.EXTRA_RETURN_RESULT, true);
        startActivityForResult(call, intent, "installerResult");
    }

    @ActivityCallback
    private void installerResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            installing.set(false);
            return;
        }
        finish(call, null); // Cancellation is retryable; success replaces this process.
    }

    private void finish(PluginCall call, Exception error) {
        installing.set(false);
        if (error == null) call.resolve();
        else call.reject("Cannot install update: " + error.getMessage(), error);
    }

    @SuppressWarnings("deprecation")
    private int signatureFlags() {
        return Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
    }

    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
    }

    @SuppressWarnings("deprecation")
    private static long code(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
                ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners())
                : info.signatures;
        Set<String> result = new HashSet<>();
        if (signatures != null) {
            for (Signature signature : signatures) {
                result.add(signature.toCharsString());
            }
        }
        return result;
    }

    private void verify(File apk, long expectedCode) throws Exception {
        PackageInfo downloaded = getContext()
                .getPackageManager()
                .getPackageArchiveInfo(apk.getAbsolutePath(), signatureFlags());
        PackageInfo current = installed();
        if (downloaded == null || !current.packageName.equals(downloaded.packageName)) {
            throw new Exception("The APK is not a SuiteLeaf update.");
        }
        if (code(downloaded) != expectedCode || code(downloaded) <= code(current)) {
            throw new Exception("APK version does not match the newer release.");
        }
        Set<String> trusted = signers(current);
        if (trusted.isEmpty() || !trusted.equals(signers(downloaded))) {
            throw new Exception("APK signing certificate does not match this installation.");
        }
    }

    private HttpURLConnection connect(String address) throws Exception {
        for (int redirects = 0; redirects < 6; redirects++) {
            URL url = new URL(address);
            String host = url.getHost();
            if (!"https".equals(url.getProtocol())
                    || !(host.equals("api.github.com")
                            || host.equals("github.com")
                            || host.endsWith(".githubusercontent.com"))) {
                throw new Exception("Untrusted update URL.");
            }
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestProperty("User-Agent", "SuiteLeaf-Android-Updater");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new Exception("Missing update redirect.");
                address = new URL(url, location).toString();
                continue;
            }
            if (status == 403 || status == 429) {
                long retry = System.currentTimeMillis() + 60 * 60 * 1000L;
                try {
                    retry = Math.max(retry, Long.parseLong(connection.getHeaderField("X-RateLimit-Reset")) * 1000);
                } catch (Exception ignored) {
                }
                try {
                    retry = Math.max(
                            retry, System.currentTimeMillis() + Long.parseLong(connection.getHeaderField("Retry-After")) * 1000);
                } catch (Exception ignored) {
                }
                prefs().edit().putLong("rate_limit_until", retry).apply();
                connection.disconnect();
                throw new Exception("GitHub refused the request or its rate limit was reached. Try again later.");
            }
            if (status != 200) {
                connection.disconnect();
                throw new Exception("GitHub returned HTTP " + status);
            }
            return connection;
        }
        throw new Exception("Too many update redirects.");
    }

    private static byte[] readLimited(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new Exception("Release response is too large.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }
}
