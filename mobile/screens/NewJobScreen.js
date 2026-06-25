import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function NewJobScreen({ jobUrl, setJobUrl, loading, analyzeJob }) {
  const { setActiveTab, t } = useApp();

  return (
    <View style={styles.aerligHomeWrap}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>{t('common.back')}</Text>
      </Pressable>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>{t('new_job.title')}</Text>
        <Text style={styles.aerligPageSubtitle}>{t('new_job.subtitle')}</Text>

        <TextInput
          style={[styles.input, styles.aerligInput]}
          placeholder={t('new_job.url_placeholder')}
          value={jobUrl}
          onChangeText={setJobUrl}
          autoCapitalize="none"
        />

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeJob}>
          <Text style={styles.aerligPrimaryButtonText}>{loading ? t('new_job.analyzing') : t('new_job.start_analysis')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.aerligCard}>
        <Text style={styles.aerligCardTitle}>{t('new_job.what_happens_title')}</Text>
        <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>{t('new_job.what_happens_body')}</Text>
      </View>
    </View>
  );
}
