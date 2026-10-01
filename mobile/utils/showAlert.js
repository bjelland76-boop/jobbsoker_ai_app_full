import { Alert, Platform } from 'react-native';

// Drop-in replacement for Alert.alert(title, message, buttons).
//
// react-native-web implements Alert.alert() as an empty function, and this
// app ships as the web build (browser + the Capacitor-wrapped Android app),
// so every plain Alert.alert() call was silently invisible in production --
// error messages, login errors, retry prompts. On web this maps onto the
// browser's own dialogs instead (Capacitor shows them as native Android
// dialogs), the same window.alert/window.confirm pattern already used for
// the confirm-with-action dialogs elsewhere in the app:
//   - no buttons, or a single non-cancel button -> window.alert(), then that
//     button's onPress
//   - a cancel button + action(s)                -> window.confirm(); OK runs
//     the LAST action, Cancel runs the cancel button's onPress
// A dialog with more than one non-cancel action can't be represented by
// window.confirm() -- callers that need that must pass a web-specific
// two-button variant (see the analytics consent prompt in useProfile.js).
export function showAlert(title, message, buttons) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = [title, message].filter((s) => s !== undefined && s !== null && String(s) !== '').join('\n\n');
  const btns = (buttons || []).filter(Boolean);
  const cancel = btns.find((b) => b.style === 'cancel');
  const actions = btns.filter((b) => b !== cancel);

  if (!cancel && actions.length <= 1) {
    // eslint-disable-next-line no-alert
    window.alert(text);
    if (actions[0]?.onPress) actions[0].onPress();
    return;
  }

  // eslint-disable-next-line no-alert
  if (window.confirm(text)) {
    const action = actions[actions.length - 1];
    if (action?.onPress) action.onPress();
  } else if (cancel?.onPress) {
    cancel.onPress();
  }
}
