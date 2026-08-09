import React from 'react';
import { Modal, View, Text, TouchableOpacity, Linking } from 'react-native';

import { styles as sharedStyles } from '../styles/styles';

const FEEDBACK_EMAIL = 'fogvshop@gmail.com';

export default function FreeLimitModal({ visible, onClose }) {
  if (!visible) return null;

  function handleSendFeedback() {
    Linking.openURL(`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Tidlig tilgang til Ærlig')}`);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={sharedStyles.cvModalOverlay}>
        <View style={sharedStyles.cvModalCard}>
          <Text style={sharedStyles.cvModalTitle}>Du har brukt dine 3 gratis analyser</Text>
          <Text style={sharedStyles.cvModalSubtitle}>
            Ærlig er gratis i lanseringsfasen — flere analyser kommer snart. Send oss en melding på {FEEDBACK_EMAIL} hvis du vil ha tidlig tilgang.
          </Text>
          <TouchableOpacity style={sharedStyles.aerligSecondaryButton} onPress={handleSendFeedback}>
            <Text style={sharedStyles.aerligSecondaryButtonText}>Send tilbakemelding</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[sharedStyles.aerligDangerButton, { marginTop: 10 }]} onPress={onClose}>
            <Text style={sharedStyles.aerligDangerButtonText}>Lukk</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
