package com.huanyang.jigsawcube;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private Insets safeArea = Insets.NONE;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.enableEdgeToEdge(getWindow());
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                applySafeArea(view);
            }
        });
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            // Keep the board still when a swipe temporarily reveals the system bars.
            int stableTypes = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            safeArea = Insets.max(insets.getInsetsIgnoringVisibility(stableTypes),
                    insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures()));
            applySafeArea(webView);
            return ViewCompat.onApplyWindowInsets(view, insets);
        });
        ViewCompat.requestApplyInsets(webView);
    }

    private void applySafeArea(WebView view) {
        // CSS fits the controls within these insets while painting the scenery to every edge.
        view.evaluateJavascript(String.format(Locale.ROOT, """
            (() => {
                if (!document.documentElement) return;
                const style = document.documentElement.style;
                const pixels = [%d, %d, %d, %d];
                ['top', 'right', 'bottom', 'left'].forEach((edge, i) => {
                    style.setProperty('--game-safe-' + edge, (pixels[i] / window.devicePixelRatio) + 'px');
                });
            })();
            """, safeArea.top, safeArea.right, safeArea.bottom, safeArea.left), null);
    }
}
