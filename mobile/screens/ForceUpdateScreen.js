import React from 'react';
import { View, Text, TouchableOpacity, Linking, Platform } from 'react-native';
import { useApp } from '../context/AppContext';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.aerlig.app';

// Blocking "please update" screen. Rendered in place of the entire app when
// the installed version is below the backend's /app-config min_version --
// see App.js. Deliberately has no close/skip/back affordance.
export default function ForceUpdateScreen() {
  const { t } = useApp();

  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      backgroundColor: '#F7F5F0',
    }}>
      <View style={{
        width: '100%',
        maxWidth: 380,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 32,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
      }}>
        <View style={{
          width: 56, height: 56, borderRadius: 16,
          backgroundColor: '#FEF0EB',
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <Text style={{ fontSize: 26 }}>⬆️</Text>
        </View>

        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', marginBottom: 10 }}>
          {t('update.title')}
        </Text>

        <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 28 }}>
          {t('update.body')}
        </Text>

        <TouchableOpacity
          style={{
            width: '100%',
            backgroundColor: '#E8501A',
            borderRadius: 8,
            paddingVertical: 14,
            alignItems: 'center',
          }}
          onPress={() => {
            Linking.openURL(PLAY_STORE_URL).catch(() => {});
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
            {t('update.play_store_btn')}
          </Text>
        </TouchableOpacity>

        {Platform.OS === 'web' && (
          <Text style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 16 }}>
            {PLAY_STORE_URL}
          </Text>
        )}
      </View>
    </View>
  );
}
