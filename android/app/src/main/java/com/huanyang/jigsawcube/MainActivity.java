package com.huanyang.jigsawcube;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(getColor(R.color.ic_launcher_background));
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            // Keep the board still when a swipe temporarily reveals the system bars.
            int stableTypes = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets safe = Insets.max(insets.getInsetsIgnoringVisibility(stableTypes),
                    insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures()));
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            // Forward the remaining insets so WebView only handles actual overlap.
            return insets.inset(safe.left, safe.top, safe.right, safe.bottom);
        });
        ViewCompat.requestApplyInsets(content);
    }
}
