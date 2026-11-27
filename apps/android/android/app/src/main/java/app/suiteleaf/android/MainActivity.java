package app.suiteleaf.android;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SuiteLeafAndroidPlugin.class);
        registerPlugin(AndroidUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // Reserve top status bar / display cutout and bottom navigation bar (Android 15+ edge-to-edge).
        boolean isNight =
                (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                        == Configuration.UI_MODE_NIGHT_YES;
        int barBg = isNight ? Color.parseColor("#181A1B") : Color.WHITE;
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(!isNight);
            controller.setAppearanceLightNavigationBars(!isNight);
        }

        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.setBackgroundColor(barBg);
            ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                        WindowInsetsCompat.Type.systemBars()
                                | WindowInsetsCompat.Type.displayCutout()
                                | WindowInsetsCompat.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(content);
        }
    }
}
