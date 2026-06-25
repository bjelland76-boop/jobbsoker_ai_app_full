import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, Switch,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function SettingsScreen({
  notificationEmail, setNotificationEmail,
  autoEmail, setAutoEmail,
  settingsLoading, settingsSaving,
  saveSettings,
}) {
  const { setActiveTab, t } = useApp();

  return (
    <View style={styles.pageCard}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>{t('common.back')}</Text>
      </Pressable>
      <Text style={styles.pageTitle}>{t('settings.title')}</Text>
      <Text style={styles.pageSubtitle}>{t('settings.subtitle')}</Text>

      <Text style={styles.inputLabel}>{t('settings.email_label')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('settings.email_placeholder')}
        value={notificationEmail}
        onChangeText={setNotificationEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>{t('settings.auto_send_label')}</Text>
        <Text style={styles.helpText}>{t('settings.auto_send_help')}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.messageText}>{autoEmail ? t('common.on') : t('common.off')}</Text>
          <Switch value={autoEmail} onValueChange={setAutoEmail} />
        </View>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={saveSettings}>
        <Text style={styles.primaryButtonText}>{settingsSaving ? t('settings.saving') : t('settings.save')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, { marginTop: 8 }]}
        onPress={() => setActiveTab('profile')}
      >
        <Text style={styles.secondaryButtonText}>{settingsLoading ? t('settings.loading') : t('settings.back_to_profile')}</Text>
      </TouchableOpacity>
    </View>
  );
}
