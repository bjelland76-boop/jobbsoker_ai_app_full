package com.aerlig.app;

import android.util.Log;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.UnfetchedProduct;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing plugin (Play Billing prep, Spor B).
 * Step 1: ping() only, proved plugin registration works.
 * Step 2: BillingClient connection lifecycle only.
 * Step 3: queryProductDetails() for the two real Play Console products.
 * Step 4 (this one): purchase() -- launchBillingFlow + PurchasesUpdatedListener,
 * returns purchaseToken to JS. No acknowledgePurchase yet (that's step 5) and
 * no backend call yet (that's step 9).
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {

    private static final String TAG = "PlayBilling";

    private BillingClient billingClient;

    // The PluginCall for an in-flight purchase() -- launchBillingFlow() has no
    // callback of its own; the result arrives later via the PurchasesUpdatedListener
    // set once below, so the call has to be kept alive and resolved from there.
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    private void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        Log.d(
            TAG,
            "onPurchasesUpdated: responseCode=" + billingResult.getResponseCode()
                + " debugMessage=" + billingResult.getDebugMessage()
                + " purchases=" + (purchases == null ? 0 : purchases.size())
        );

        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;
        if (call == null) {
            Log.w(TAG, "onPurchasesUpdated fired with no pending purchase() call -- ignoring");
            return;
        }

        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("Bruker avbrøt kjøpet");
            return;
        }
        if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            call.reject("Kjøpet feilet (responseCode=" + billingResult.getResponseCode() + "): " + billingResult.getDebugMessage());
            return;
        }

        Purchase purchase = purchases.get(0);
        Log.d(
            TAG,
            "purchase completed: products=" + purchase.getProducts()
                + " purchaseState=" + purchase.getPurchaseState()
                + " isAcknowledged=" + purchase.isAcknowledged()
        );

        JSObject ret = new JSObject();
        ret.put("purchaseToken", purchase.getPurchaseToken());
        ret.put("orderId", purchase.getOrderId());
        ret.put("products", new JSArray(purchase.getProducts()));
        ret.put("purchaseState", purchase.getPurchaseState());
        ret.put("isAcknowledged", purchase.isAcknowledged());
        call.resolve(ret);
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

    // Same two known products/types as queryProductDetails() -- re-queries
    // ProductDetails for just the requested one so purchase() doesn't depend
    // on queryProductDetails() having been called first.
    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || productId.isEmpty()) {
            call.reject("productId er påkrevd");
            return;
        }
        if (!billingClient.isReady()) {
            call.reject("BillingClient er ikke tilkoblet -- kall startConnection() først");
            return;
        }
        if (pendingPurchaseCall != null) {
            call.reject("Et kjøp er allerede i gang");
            return;
        }

        String productType;
        if ("1_maanedsabonnement".equals(productId)) {
            productType = BillingClient.ProductType.SUBS;
        } else if ("7dager".equals(productId)) {
            productType = BillingClient.ProductType.INAPP;
        } else {
            call.reject("Ukjent productId: " + productId);
            return;
        }

        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(productType).build());
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(products).build();

        billingClient.queryProductDetailsAsync(params, (billingResult, result) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK || result.getProductDetailsList().isEmpty()) {
                Log.e(TAG, "purchase: fant ikke ProductDetails for " + productId + " (responseCode=" + billingResult.getResponseCode() + ")");
                call.reject("Fant ikke produktdetaljer for " + productId + " (responseCode=" + billingResult.getResponseCode() + ")");
                return;
            }

            ProductDetails details = result.getProductDetailsList().get(0);
            String offerToken = null;

            if (BillingClient.ProductType.SUBS.equals(productType)) {
                List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
                if (offers != null && !offers.isEmpty()) {
                    offerToken = offers.get(0).getOfferToken();
                }
            } else {
                ProductDetails.OneTimePurchaseOfferDetails offer = details.getOneTimePurchaseOfferDetails();
                if (offer != null) {
                    offerToken = offer.getOfferToken();
                }
            }

            if (offerToken == null) {
                call.reject("Fant ingen tilgjengelig offer for " + productId);
                return;
            }

            BillingFlowParams.ProductDetailsParams productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .setOfferToken(offerToken)
                .build();

            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(productDetailsParams))
                .build();

            pendingPurchaseCall = call;
            call.setKeepAlive(true);

            BillingResult launchResult = billingClient.launchBillingFlow(getActivity(), flowParams);
            Log.d(TAG, "launchBillingFlow: responseCode=" + launchResult.getResponseCode() + " debugMessage=" + launchResult.getDebugMessage());

            if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                pendingPurchaseCall = null;
                call.reject("launchBillingFlow feilet (responseCode=" + launchResult.getResponseCode() + "): " + launchResult.getDebugMessage());
            }
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
