import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time migration (v52): the analytics consent prompt was an Alert.alert()
// and therefore never actually shown in the web/Capacitor build. Now that it
// becomes visible, installs that existed BEFORE this version are marked as
// already asked -- with consent left at its default (false), never assumed
// -- so the prompt doesn't suddenly pop up for every existing user without
// context. Only genuinely new installs see it.
//
// Must snapshot install state at app start, before this session's own
// actions write any of these keys (a new user creating a profile or logging
// in would otherwise look like an existing one) -- hence a module-level
// promise, started when this module is first imported (AppContext, at the
// root of the app), and awaited by the consent prompt.
const MIGRATION_KEY = 'consentPromptMigrationV52';
const PROMPTED_KEY = 'analyticsConsentPrompted';
// Written only by a user's own earlier actions, never automatically on a
// fresh install's first launch.
const EXISTING_INSTALL_KEYS = ['onboarding_shown', 'authToken', 'anonProfileId'];

async function run() {
  try {
    if (await AsyncStorage.getItem(MIGRATION_KEY)) return;
    const values = await Promise.all(EXISTING_INSTALL_KEYS.map((k) => AsyncStorage.getItem(k)));
    if (values.some((v) => v !== null && v !== undefined && v !== '')) {
      await AsyncStorage.setItem(PROMPTED_KEY, 'yes');
    }
    await AsyncStorage.setItem(MIGRATION_KEY, 'done');
  } catch (e) {
    // ignore -- worst case an existing user sees the prompt once
  }
}

export const consentMigrationDone = run();
