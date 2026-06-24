import React from 'react';
import {
  View, Text, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function CvAnalysisScreen({ cvAnalysis, cvLoading, analyzeCv }) {
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
        <Text style={styles.aerligPageTitle}>Analyser CV / profil</Text>
        <Text style={styles.aerligPageSubtitle}>Få forslag til relevante jobber og råd basert på utdanning og erfaring.</Text>

        <TouchableOpacity style={styles.aerligPrimaryButton} onPress={analyzeCv}>
          <Text style={styles.aerligPrimaryButtonText}>{cvLoading ? 'Analyserer...' : 'Analyser profilen min'}</Text>
        </TouchableOpacity>
      </View>

      {cvAnalysis ? (
        <View style={[styles.aerligCard, styles.aerligAccentNavy]}>
          {!cvAnalysis.summary && !cvAnalysis.suggested_roles?.length && !cvAnalysis.strengths?.length ? (
            <Text style={styles.aerligCardBody}>
              Profilen din mangler nok informasjon for en god analyse. Fyll ut CV/erfaring i profilen din først.
            </Text>
          ) : null}
          {cvAnalysis.summary ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Oppsummering</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.summary}</Text>
            </>
          ) : null}

          {cvAnalysis.education_fit ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Hva du er kvalifisert til</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.education_fit}</Text>
            </>
          ) : null}

          {cvAnalysis.suggested_roles?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Jobbtyper du kan søke på</Text>
              {cvAnalysis.suggested_roles.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.strengths?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Styrker</Text>
              {cvAnalysis.strengths.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.gaps?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Mulige hull / svakheter</Text>
              {cvAnalysis.gaps.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.improvement_tips?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Konkrete råd</Text>
              {cvAnalysis.improvement_tips.map((item, idx) => (
                <Text key={idx} style={styles.aerligCardBody}>• {item}</Text>
              ))}
            </>
          ) : null}

          {cvAnalysis.search_keywords?.length > 0 ? (
            <>
              <Text style={styles.aerligCardSectionTitle}>Søkeord</Text>
              <Text style={styles.aerligCardBody}>{cvAnalysis.search_keywords.join(', ')}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
