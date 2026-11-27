package app.suiteleaf.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidUpdateReleaseTest {
    @Test
    public void versionCodeEncodesSemverDeterministically() {
        assertEquals(1001L, AndroidUpdateRelease.versionCode("0.1.0"));
        assertEquals(1002L, AndroidUpdateRelease.versionCode("0.1.1"));
        assertEquals(1_002_004L, AndroidUpdateRelease.versionCode("1.2.3"));
        assertEquals(-1L, AndroidUpdateRelease.versionCode("1.2"));
        assertEquals(-1L, AndroidUpdateRelease.versionCode("v1.2.3"));
    }

    @Test
    public void selectsNewestValidSuiteLeafAndroidRelease() throws Exception {
        JSONArray releases = new JSONArray();
        // Draft release should be skipped
        releases.put(release("v0.3.0", true, false, "SuiteLeaf-0.3.0-android.apk",
                "https://github.com/MisterTea/SuiteLeaf/releases/download/v0.3.0/SuiteLeaf-0.3.0-android.apk"));
        // Prerelease should be skipped
        releases.put(release("v0.2.5", false, true, "SuiteLeaf-0.2.5-android.apk",
                "https://github.com/MisterTea/SuiteLeaf/releases/download/v0.2.5/SuiteLeaf-0.2.5-android.apk"));
        // Untrusted URL should be skipped
        releases.put(release("v0.2.2", false, false, "SuiteLeaf-0.2.2-android.apk",
                "https://evil.example.com/SuiteLeaf-0.2.2-android.apk"));
        // Valid newer release
        releases.put(release("v0.2.0", false, false, "SuiteLeaf-0.2.0-android.apk",
                "https://github.com/MisterTea/SuiteLeaf/releases/download/v0.2.0/SuiteLeaf-0.2.0-android.apk"));
        // Older release
        releases.put(release("v0.1.0", false, false, "SuiteLeaf-0.1.0-android.apk",
                "https://github.com/MisterTea/SuiteLeaf/releases/download/v0.1.0/SuiteLeaf-0.1.0-android.apk"));

        AndroidUpdateRelease chosen = AndroidUpdateRelease.select(releases, 1001L, null);
        assertNotNull(chosen);
        assertEquals("0.2.0", chosen.version);
        assertEquals(2001L, chosen.code);

        // Already up to date
        assertNull(AndroidUpdateRelease.select(releases, 2001L, null));
    }

    private static JSONObject release(
            String tag, boolean draft, boolean prerelease, String assetName, String url) throws Exception {
        JSONObject asset = new JSONObject()
                .put("name", assetName)
                .put("state", "uploaded")
                .put("browser_download_url", url);
        return new JSONObject()
                .put("tag_name", tag)
                .put("draft", draft)
                .put("prerelease", prerelease)
                .put("body", "Release notes for " + tag)
                .put("assets", new JSONArray().put(asset));
    }
}
