import React from 'react';
import {
  View, Text, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function ApplicationsScreen({
  applications, applicationsLoading, appSortOrder, setAppSortOrder,
  statsMe, consentAnalytics,
  updateApplicationProgress, loadApplications,
}) {
  const { setActiveTab } = useApp();

  function toggle(item, field) {
    const applied = !!item.applied;
    const interviewed = !!item.interviewed;
    const gotJob = !!item.got_job;

    let patch = {};

    if (field === 'applied') {
      const next = !applied;
      patch = next
        ? { applied: true }
        : { applied: false, interviewed: false, got_job: false };
    } else if (field === 'interviewed') {
      const next = !interviewed;
      patch = next
        ? { interviewed: true, applied: true }
        : { interviewed: false, got_job: false };
    } else if (field === 'got_job') {
      const next = !gotJob;
      patch = next
        ? { got_job: true }
        : { got_job: false };
    }

    updateApplicationProgress(item.job.id, patch);
  }

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
        <Text style={styles.aerligPageTitle}>Søknader</Text>
        <Text style={styles.aerligPageSubtitle}>Én linje per jobb. Huk av status etter hvert.</Text>

        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, marginBottom: 4 }}>
          {[
            { key: 'newest', label: 'Nyeste først' },
            { key: 'status', label: 'Status' },
            { key: 'name', label: 'Navn A-Å' },
          ].map(({ key, label }) => (
            <TouchableOpacity key={key} onPress={() => setAppSortOrder(key)}
              style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
                backgroundColor: appSortOrder === key ? 'rgba(232,80,26,0.08)' : 'transparent' }}>
              <Text style={{ fontSize: 13, fontWeight: appSortOrder === key ? '600' : '400',
                color: appSortOrder === key ? '#E8501A' : '#888888',
                borderBottomWidth: appSortOrder === key ? 1.5 : 0,
                borderBottomColor: '#E8501A' }}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={loadApplications}>
          <Text style={styles.aerligSecondaryButtonText}>{applicationsLoading ? 'Laster...' : 'Oppdater liste'}</Text>
        </TouchableOpacity>

        {applicationsLoading ? (
          <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 10, marginBottom: 0 }]}>Laster søknader...</Text>
        ) : null}
      </View>

      {!consentAnalytics ? (
        <View style={[styles.aerligCard, styles.aerligAccentOrange]}>
          <Text style={styles.aerligCardTitle}>Anonym statistikk: AV</Text>
          <Text style={[styles.aerligCardBody, { marginTop: 6 }]}>Hvis du skrur på anonym statistikk i Profil, kan resultatene dine inngå i samlet statistikk.</Text>
        </View>
      ) : null}

      {statsMe ? (
        <View style={styles.aerligCard}>
          <Text style={[styles.aerligCardTitle, { marginBottom: 12 }]}>Din statistikk</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[
              { icon: '📋', value: statsMe.total, label: 'Totalt' },
              { icon: '📤', value: statsMe.applied, label: 'Sendt' },
              { icon: '💬', value: statsMe.interviewed, label: 'Intervju' },
              { icon: '⭐', value: statsMe.got_job, label: 'Fikk jobb' },
            ].map((item) => (
              <View key={item.label} style={{
                flex: 1, minWidth: '40%',
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                padding: 14,
                shadowColor: '#000',
                shadowOpacity: 0.06,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
                alignItems: 'flex-start',
              }}>
                <Text style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</Text>
                <Text style={{ fontSize: 24, fontWeight: '600', color: '#1a1a1a', lineHeight: 28 }}>{item.value ?? 0}</Text>
                <Text style={{ fontSize: 12, color: '#888888', marginTop: 2 }}>{item.label}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontSize: 12, color: '#aaaaaa', marginTop: 10 }}>
            Intervju-rate: {Math.round((statsMe.interview_rate || 0) * 100)}% · Jobb-rate: {Math.round((statsMe.hire_rate || 0) * 100)}%
          </Text>
        </View>
      ) : null}

      {!applicationsLoading && applications.length === 0 ? (
        <View style={[styles.aerligCard, { alignItems: 'center', paddingVertical: 32 }]}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>📋</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6, textAlign: 'center' }}>Ingen søknader ennå</Text>
          <Text style={{ fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
            Start med å analysere en jobb for å komme i gang
          </Text>
          <TouchableOpacity style={[styles.aerligPrimaryButton, { paddingHorizontal: 24 }]} onPress={() => setActiveTab('new')}>
            <Text style={styles.aerligPrimaryButtonText}>Analyser jobb</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {applications.length > 0 ? (() => {
        const sorted = [...applications].sort((a, b) => {
          if (appSortOrder === 'name') {
            return (a.job.title || '').localeCompare(b.job.title || '', 'no');
          }
          if (appSortOrder === 'status') {
            const rank = (i) => i.got_job ? 3 : i.interviewed ? 2 : i.applied ? 1 : 0;
            return rank(b) - rank(a);
          }
          return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
        });
        return (
          <View style={styles.aerligAppsTableCard}>
            <View style={styles.aerligAppsTableHeaderRow}>
              <Text style={[styles.aerligAppsTableHeaderCell, styles.aerligAppsTableJobHeader]}>Jobb</Text>
              <Text style={styles.aerligAppsTableHeaderCell}>Søkt</Text>
              <Text style={styles.aerligAppsTableHeaderCell}>Intervju</Text>
              <Text style={styles.aerligAppsTableHeaderCell}>Jobb</Text>
            </View>

            {sorted.map((item) => (
              <View key={item.job.id} style={styles.aerligAppsTableRow}>
                <View style={styles.aerligAppsTableJobCell}>
                  <Text style={styles.aerligAppsTableJobTitle} numberOfLines={1}>{item.job.title}</Text>
                  <Text style={styles.aerligAppsTableJobCompany} numberOfLines={1}>{item.job.company || 'Ukjent bedrift'}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.aerligAppsCheckbox, item.applied && styles.aerligAppsCheckboxOn]}
                  onPress={() => toggle(item, 'applied')}
                >
                  <Text style={[styles.aerligAppsCheckboxText, item.applied && styles.aerligAppsCheckboxTextOn]}>{item.applied ? '✓' : ''}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.aerligAppsCheckbox, item.interviewed && styles.aerligAppsCheckboxOn]}
                  onPress={() => toggle(item, 'interviewed')}
                >
                  <Text style={[styles.aerligAppsCheckboxText, item.interviewed && styles.aerligAppsCheckboxTextOn]}>{item.interviewed ? '✓' : ''}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.aerligAppsCheckbox, item.got_job && styles.aerligAppsCheckboxOn]}
                  onPress={() => toggle(item, 'got_job')}
                >
                  <Text style={[styles.aerligAppsCheckboxText, item.got_job && styles.aerligAppsCheckboxTextOn]}>{item.got_job ? '✓' : ''}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        );
      })() : null}
    </View>
  );
}
