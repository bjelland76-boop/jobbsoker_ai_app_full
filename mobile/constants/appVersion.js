import { Platform } from 'react-native';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

// Fallback version code used on web (no native versionCode there) and if the
// native App.getInfo() call fails for any reason. Keep in sync with
// mobile/android/app/build.gradle's `versionCode` on every release bump --
// this is the only place that requires a manual update alongside it.
export const WEB_VERSION_CODE = 31;

// Resolves the running app's version code: the real native Android
// versionCode when running inside the packaged Capacitor app (authoritative,
// can never drift out of sync since it's read from the installed build
// itself), or WEB_VERSION_CODE otherwise.
export async function getCurrentVersionCode() {
  if (Platform.OS === 'web' || !Capacitor.isNativePlatform()) {
    return WEB_VERSION_CODE;
  }
  try {
    const info = await CapacitorApp.getInfo();
    const build = parseInt(info?.build, 10);
    return Number.isFinite(build) ? build : WEB_VERSION_CODE;
  } catch (e) {
    return WEB_VERSION_CODE;
  }
}
