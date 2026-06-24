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
  const { setActiveTab } = useApp();

  return (
    <View style={styles.pageCard}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>
      <Text style={styles.pageTitle}>E-postinnstillinger</Text>
      <Text style={styles.pageSubtitle}>Brukes når du sender søknad/CV på e-post fra en analyse.</Text>

      <Text style={styles.inputLabel}>Varslings-e-post</Text>
      <TextInput
        style={styles.input}
        placeholder="din@epost.no"
        value={notificationEmail}
        onChangeText={setNotificationEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <View style={styles.profileField}>
        <Text style={styles.inputLabel}>Auto-send (valgfritt)</Text>
        <Text style={styles.helpText}>Denne innstillingen er i praksis ikke brukt i URL-baserte analyser, men kan brukes i fremtidige utvidelser.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.messageText}>{autoEmail ? 'På' : 'Av'}</Text>
          <Switch value={autoEmail} onValueChange={setAutoEmail} />
        </View>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={saveSettings}>
        <Text style={styles.primaryButtonText}>{settingsSaving ? 'Lagrer...' : 'Lagre'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, { marginTop: 8 }]}
        onPress={() => setActiveTab('profile')}
      >
        <Text style={styles.secondaryButtonText}>{settingsLoading ? 'Laster...' : 'Tilbake til Profil'}</Text>
      </TouchableOpacity>
    </View>
  );
}
