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
  const [langOpen, setLangOpen] = useState(false);

  const LANGS = [
    { code: 'no', flag: '🇳🇴', name: 'Norsk' },
    { code: 'en', flag: '🇬🇧', name: 'English' },
    { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
    { code: 'pl', flag: '🇵🇱', name: 'Polski' },
    { code: 'lt', flag: '🇱🇹', name: 'Lietuvių' },
    { code: 'ar', flag: '🇸🇦', name: 'العربية' },
    { code: 'so', flag: '🇸🇴', name: 'Soomaali' },
  ];
  const activeLang = LANGS.find(l => l.code === uiLanguage) || LANGS[0];

  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 40,
    }}>
      {/* Language dropdown — top right */}
      <View style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
        <TouchableOpacity
          onPress={() => setLangOpen(o => !o)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
            borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
            shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
          }}
        >
          <Text style={{ fontSize: 16 }}>{activeLang.flag}</Text>
          <Text style={{ fontSize: 13, color: '#374151', fontWeight: '500' }}>{activeLang.name}</Text>
          <Text style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 2 }}>{langOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {langOpen && (
          <View style={{
            position: 'absolute', top: 40, right: 0,
            backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb',
            minWidth: 150, zIndex: 100,
            shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 8,
            overflow: 'hidden',
          }}>
            {LANGS.map(({ code, flag, name }, i) => (
              <TouchableOpacity
                key={code}
                onPress={() => { setAndPersistUiLanguage(code); setLangOpen(false); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 12, paddingVertical: 11,
                  backgroundColor: uiLanguage === code ? '#FEF0EB' : '#fff',
                  borderBottomWidth: i < LANGS.length - 1 ? 1 : 0,
                  borderBottomColor: '#F3F4F6',
                }}
              >
                <Text style={{ fontSize: 16 }}>{flag}</Text>
                <Text style={{
                  fontSize: 13, fontWeight: uiLanguage === code ? '700' : '400',
                  color: uiLanguage === code ? '#E8501A' : '#374151',
                }}>{name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
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
