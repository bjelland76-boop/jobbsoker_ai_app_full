package com.aerlig.app;

import android.util.Log;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.UnfetchedProduct;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Google Play Billing plugin (Play Billing prep, Spor B).
 * Step 1: ping() only, proved plugin registration works.
 * Step 2: BillingClient connection lifecycle only.
 * Step 3 (this one): queryProductDetails() for the two real Play Console
 * products -- no purchase flow yet (that's step 4).
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

    // The app's two real Play Console products (confirmed in Play Console):
    // "7dager" is a one-time managed product (INAPP), "1_maanedsabonnement"
    // is a recurring subscription (SUBS). Play Billing Library 9.x rejects a
    // single queryProductDetailsAsync call that mixes product types
    // ("IllegalArgumentException: All products should be of the same
    // product type") -- confirmed by an on-device crash while building this
    // step -- so this issues two separate queries and merges the results.
    @PluginMethod
    public void queryProductDetails(PluginCall call) {
        if (!billingClient.isReady()) {
            call.reject("BillingClient er ikke tilkoblet -- kall startConnection() først");
            return;
        }

        JSArray productsOut = new JSArray();
        JSArray unfetchedOut = new JSArray();

        List<QueryProductDetailsParams.Product> subsProducts = new ArrayList<>();
        subsProducts.add(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId("1_maanedsabonnement")
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        );

        List<QueryProductDetailsParams.Product> inappProducts = new ArrayList<>();
        inappProducts.add(
            QueryProductDetailsParams.Product.newBuilder().setProductId("7dager").setProductType(BillingClient.ProductType.INAPP).build()
        );

        queryOneType("SUBS", subsProducts, productsOut, unfetchedOut, call, () ->
            queryOneType("INAPP", inappProducts, productsOut, unfetchedOut, call, () -> {
                JSObject ret = new JSObject();
                ret.put("products", productsOut);
                ret.put("unfetched", unfetchedOut);
                call.resolve(ret);
            })
        );
    }

    private void queryOneType(
        String label,
        List<QueryProductDetailsParams.Product> products,
        JSArray productsOut,
        JSArray unfetchedOut,
        PluginCall call,
        Runnable onDone
    ) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(products).build();

        billingClient.queryProductDetailsAsync(params, (billingResult, result) -> {
            Log.d(
                TAG,
                "onProductDetailsResponse (" + label + "): responseCode=" + billingResult.getResponseCode()
                    + " debugMessage=" + billingResult.getDebugMessage()
                    + " found=" + result.getProductDetailsList().size()
                    + " unfetched=" + result.getUnfetchedProductList().size()
            );

            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("queryProductDetailsAsync (" + label + ") feilet (responseCode=" + billingResult.getResponseCode() + "): " + billingResult.getDebugMessage());
                return;
            }

            for (ProductDetails details : result.getProductDetailsList()) {
                JSObject item = new JSObject();
                item.put("productId", details.getProductId());
                item.put("title", details.getTitle());
                item.put("productType", details.getProductType());

                if (BillingClient.ProductType.SUBS.equals(details.getProductType())) {
                    List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
                    if (offers != null && !offers.isEmpty()) {
                        List<ProductDetails.PricingPhase> phases = offers.get(0).getPricingPhases().getPricingPhaseList();
                        if (!phases.isEmpty()) {
                            ProductDetails.PricingPhase phase = phases.get(0);
                            item.put("formattedPrice", phase.getFormattedPrice());
                            item.put("priceCurrencyCode", phase.getPriceCurrencyCode());
                            item.put("billingPeriod", phase.getBillingPeriod());
                        }
                    }
                } else {
                    ProductDetails.OneTimePurchaseOfferDetails offer = details.getOneTimePurchaseOfferDetails();
                    if (offer != null) {
                        item.put("formattedPrice", offer.getFormattedPrice());
                        item.put("priceCurrencyCode", offer.getPriceCurrencyCode());
                    }
                }

                Log.d(TAG, "product: " + details.getProductId() + " title=" + details.getTitle());
                productsOut.put(item);
            }

            for (UnfetchedProduct unfetched : result.getUnfetchedProductList()) {
                JSObject u = new JSObject();
                u.put("productId", unfetched.getProductId());
                u.put("statusCode", unfetched.getStatusCode());
                Log.w(TAG, "unfetched product: " + unfetched.getProductId() + " statusCode=" + unfetched.getStatusCode());
                unfetchedOut.put(u);
            }

            onDone.run();
        });
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
