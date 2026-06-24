import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function NewJobScreen({ jobUrl, setJobUrl, loading, analyzeJob }) {
  const { setActiveTab } = useApp();

  return (
    <View style={styles.aerligHomeWrap}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>Ny søknad</Text>
        <Text style={styles.aerligPageSubtitle}>Start ny jobbprosjekt med en annonse-URL.</Text>

        <TextInput
          style={[styles.input, styles.aerligInput]}
          placeholder="Lim inn jobbannonse-URL"
          value={jobUrl}
          onChangeText={setJobUrl}
          autoCapitalize="none"
        />

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
          <Text style={styles.aerligPrimaryButtonText}>{loading ? 'Analyserer...' : 'Start analyse'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.aerligCard}>
        <Text style={styles.aerligCardTitle}>Hva skjer nå?</Text>
        <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>Du får oversikt over krav, match og hva du bør fremheve i søknaden.</Text>
      </View>
    </View>
  );
}
