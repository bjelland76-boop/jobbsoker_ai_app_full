import { registerPlugin } from '@capacitor/core';

// Local, in-house native plugin (not an npm package) -- Google Play Billing
// wrapper around BillingClient. See android/app/src/main/java/com/aerlig/app/PlayBillingPlugin.java.
// Only ping() exists so far (Play Billing prep, Spor B step 1).
const PlayBilling = registerPlugin('PlayBilling');

export default PlayBilling;
