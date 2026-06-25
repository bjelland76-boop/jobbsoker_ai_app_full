import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert,
} from 'react-native';
import { useApp, apiFetch } from '../context/AppContext';

export default function AuthScreen() {
  const {
    authEmail, setAuthEmail,
    authCode, setAuthCode,
    codeSent, setCodeSent,
    resendCooldown, setResendCooldown,
    authLoading,
    doAuth,
    errText,
    t,
    uiLanguage,
    setAndPersistUiLanguage,
  } = useApp();

  const [resendLoading, setResendLoading] = useState(false);

  const LANGS = [
    { code: 'no', flag: '🇳🇴' },
    { code: 'en', flag: '🇬🇧' },
    { code: 'vi', flag: '🇻🇳' },
  ];

  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 40,
    }}>
      {/* Language selector — top right */}
      <View style={{
        position: 'absolute', top: 16, right: 16,
        flexDirection: 'row', gap: 4,
      }}>
        {LANGS.map(({ code, flag }) => (
          <TouchableOpacity
            key={code}
            onPress={() => setAndPersistUiLanguage(code)}
            style={{
              paddingHorizontal: 8, paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: uiLanguage === code ? '#FEF0EB' : 'transparent',
              borderBottomWidth: uiLanguage === code ? 2 : 0,
              borderBottomColor: '#E8501A',
            }}
          >
            <Text style={{ fontSize: 18 }}>{flag}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{
        width: '100%',
        maxWidth: 380,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 32,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
      }}>
        {/* Icon box */}
        <View style={{
          width: 44, height: 44, borderRadius: 12,
          backgroundColor: '#FEF0EB',
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <Text style={{ fontSize: 20 }}>💼</Text>
        </View>

        {/* Logo */}
        <Text style={{ fontSize: 28, fontWeight: '600', color: '#1a1a1a', letterSpacing: -0.5 }}>
          Ærlig<Text style={{ color: '#E8501A' }}>.</Text>
        </Text>

        {/* Tagline */}
        <Text style={{ fontSize: 14, color: '#888', marginTop: 4, marginBottom: 28, lineHeight: 20 }}>
          {t('auth.tagline')}
        </Text>

        {/* Email label + input */}
        <Text style={{ fontSize: 12, fontWeight: '500', color: '#555', marginBottom: 6 }}>
          {t('auth.email_label')}
        </Text>
        <TextInput
          style={{
            width: '100%',
            borderWidth: 1.5,
            borderColor: '#e0e0e0',
            borderRadius: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
            fontSize: 14,
            color: '#1a1a1a',
            backgroundColor: '#FAFAFA',
          }}
          placeholder={t('auth.email_placeholder')}
          value={authEmail}
          onChangeText={(v) => {
            setAuthEmail(v);
            if (codeSent) {
              setCodeSent(false);
              setResendCooldown(0);
              setAuthCode('');
            }
          }}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        {codeSent ? (
          <>
            <Text style={{ fontSize: 12, fontWeight: '500', color: '#555', marginTop: 14, marginBottom: 6 }}>
              {t('auth.code_label')}
            </Text>
            <TextInput
              style={{
                width: '100%',
                borderWidth: 1.5,
                borderColor: '#e0e0e0',
                borderRadius: 8,
                paddingVertical: 10,
                paddingHorizontal: 14,
                fontSize: 14,
                color: '#1a1a1a',
                backgroundColor: '#FAFAFA',
              }}
              placeholder={t('auth.code_placeholder')}
              value={authCode}
              onChangeText={setAuthCode}
              autoCapitalize="none"
              keyboardType="numeric"
            />
          </>
        ) : null}

        {/* Primary button */}
        <TouchableOpacity
          style={{
            width: '100%',
            backgroundColor: authLoading ? '#f0a080' : '#E8501A',
            borderRadius: 8,
            paddingVertical: 12,
            alignItems: 'center',
            marginTop: 12,
          }}
          onPress={doAuth}
          disabled={!!authLoading}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>
            {authLoading ? t('auth.sending') : (codeSent ? t('auth.login') : t('auth.send_code'))}
          </Text>
        </TouchableOpacity>

        {/* Resend */}
        {codeSent ? (
          <TouchableOpacity
            style={{ marginTop: 10, alignItems: 'center', opacity: resendCooldown ? 0.5 : 1 }}
            disabled={!!resendCooldown || !!authLoading || resendLoading}
            onPress={async () => {
              if (!authEmail || resendCooldown) return;
              setResendLoading(true);
              try {
                await apiFetch('/auth/request-code', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: authEmail }),
                });
                setAuthCode('');
                setResendCooldown(30);
                Alert.alert(t('auth.code_sent_title'), t('auth.code_sent_body'));
              } catch (e) {
                if (e.status === 429) {
                  Alert.alert(t('common.too_many_attempts_title'), t('common.too_many_attempts_body'));
                } else {
                  Alert.alert(t('common.error'), errText(e));
                }
              }
              setResendLoading(false);
            }}
          >
            <Text style={{ fontSize: 13, color: '#E8501A' }}>
              {resendCooldown ? t('auth.resend_code_wait', { seconds: resendCooldown }) : t('auth.resend_code')}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Footer */}
        <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 20 }}>
          {t('auth.no_password')}
        </Text>
      </View>
    </View>
  );
}
