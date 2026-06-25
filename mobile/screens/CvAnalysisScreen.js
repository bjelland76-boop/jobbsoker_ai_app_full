import React from 'react';
import {
  View, Text, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function CvAnalysisScreen({ cvAnalysis, cvLoading, analyzeCv }) {
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
        <Text style={styles.aerligPageTitle}>{t('cv_analysis.title')}</Text>
        <Text style={styles.aerligPageSubtitle}>{t('cv_analysis.subtitle')}</Text>

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeCv}>
          <Text style={styles.aerligPrimaryButtonText}>{cvLoading ? t('cv_analysis.analyzing') : t('cv_analysis.analyze_btn')}</Text>
        </TouchableOpacity>
      </View>

      {cvAnalysis ? (
        <View style={[styles.aerligCard, styles.aerligAccentNavy]}>
          {!cvAnalysis.summary && !cvAnalysis.suggested_roles?.length && !cvAnalysis.strengths?.length ? (
            <Text style={styles.aerligCardBody}>
              {t('cv_analysis.no_info')}
            </Text>
          ) : null}
          {cvAnalysis.summary ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.summary')}</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.summary}</Text>
            </>
          ) : null}

          {cvAnalysis.education_fit ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.education_fit')}</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.education_fit}</Text>
            </>
          ) : null}

          {cvAnalysis.suggested_roles?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.suggested_roles')}</Text>
              {cvAnalysis.suggested_roles.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.strengths?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.strengths')}</Text>
              {cvAnalysis.strengths.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.gaps?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.gaps')}</Text>
              {cvAnalysis.gaps.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.improvement_tips?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.improvement_tips')}</Text>
              {cvAnalysis.improvement_tips.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.search_keywords?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>{t('cv_analysis.search_keywords')}</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.search_keywords.join(', ')}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
