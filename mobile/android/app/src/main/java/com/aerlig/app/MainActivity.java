package com.aerlig.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView's HTTP cache persists across Play Store app updates (it's part of
        // app data, not the APK), so a stale index.html/bundle can keep being served after
        // an update unless we force it to always read the freshly installed assets.
        getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
    }
}
