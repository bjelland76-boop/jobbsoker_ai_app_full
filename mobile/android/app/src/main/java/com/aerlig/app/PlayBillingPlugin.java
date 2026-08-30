package com.aerlig.app;

import android.util.Log;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google Play Billing plugin (Play Billing prep, Spor B).
 * Step 1: ping() only, proved plugin registration works.
 * Step 2 (this one): BillingClient connection lifecycle only -- no product
 * queries or purchase flow yet (that's step 3/4).
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {

    private static final String TAG = "PlayBilling";

    private BillingClient billingClient;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener((billingResult, purchases) -> {
                // Real purchase handling arrives in step 4 -- this step only
                // connects, so just log if anything unexpected comes through.
                Log.d(
                    TAG,
                    "onPurchasesUpdated (unused until step 4): responseCode=" + billingResult.getResponseCode()
                        + " purchases=" + (purchases == null ? 0 : purchases.size())
                );
            })
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    @PluginMethod
    public void startConnection(PluginCall call) {
        if (billingClient.isReady()) {
            Log.d(TAG, "startConnection: already connected (connectionState=" + billingClient.getConnectionState() + ")");
            call.resolve(connectionStatus());
            return;
        }

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                Log.d(
                    TAG,
                    "onBillingSetupFinished: responseCode=" + billingResult.getResponseCode()
                        + " debugMessage=" + billingResult.getDebugMessage()
                        + " connectionState=" + billingClient.getConnectionState()
                );
                JSObject ret = connectionStatus();
                ret.put("responseCode", billingResult.getResponseCode());
                ret.put("debugMessage", billingResult.getDebugMessage());
                call.resolve(ret);
            }

            @Override
            public void onBillingServiceDisconnected() {
                // No PluginCall to resolve here -- this fires independently of any
                // in-flight startConnection() call, sometimes long after one resolved.
                Log.w(TAG, "onBillingServiceDisconnected: connection lost, will need startConnection() again");
            }
        });
    }

    @PluginMethod
    public void endConnection(PluginCall call) {
        billingClient.endConnection();
        Log.d(TAG, "endConnection: connectionState=" + billingClient.getConnectionState());
        call.resolve(connectionStatus());
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        call.resolve(connectionStatus());
    }

    @PluginMethod
    public void ping(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private JSObject connectionStatus() {
        JSObject ret = new JSObject();
        ret.put("ready", billingClient.isReady());
        ret.put("connectionState", billingClient.getConnectionState());
        return ret;
    }
}
