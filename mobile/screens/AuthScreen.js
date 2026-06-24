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
  } = useApp();

  const [resendLoading, setResendLoading] = useState(false);

  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 40,
    }}>
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
          Din ærlige jobbcoach — søknader og intervjutrening som faktisk funker
        </Text>

        {/* E-post label + input */}
        <Text style={{ fontSize: 12, fontWeight: '500', color: '#555', marginBottom: 6 }}>
          E-post
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
          placeholder="navn@epost.no"
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
              Engangskode
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
              placeholder="6-sifret kode"
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
            {authLoading ? 'Sender...' : (codeSent ? 'Logg inn' : 'Send engangskode')}
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
                Alert.alert('Kode sendt', 'Vi har sendt en ny engangskode på e-post.');
              } catch (e) {
                if (e.status === 429) {
                  Alert.alert('For mange forsøk', 'Vent noen minutter og prøv igjen.');
                } else {
                  Alert.alert('Feil', errText(e));
                }
              }
              setResendLoading(false);
            }}
          >
            <Text style={{ fontSize: 13, color: '#E8501A' }}>
              {resendCooldown ? `Send ny kode (${resendCooldown}s)` : 'Send ny kode'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Footer */}
        <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 20 }}>
          Ingen passord. Ingen stress.
        </Text>
      </View>
    </View>
  );
}
