import React from 'react';
import {
  View, Text, TouchableOpacity, Pressable,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { styles } from '../styles/styles';

export default function DocumentsScreen({
  applicationPackage, documents, documentsLoading,
  openDocument, loadDocuments,
}) {
  const { setActiveTab } = useApp();

  return (
    <View style={styles.pageCard}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
      </Pressable>
      <Text style={styles.pageTitle}>Dokumenter</Text>
      <Text style={styles.pageSubtitle}>Her finner du genererte PDF-er (søknad + CV i samme fil).</Text>

      {applicationPackage ? (
        <View style={styles.analysisCard}>
          <Text style={styles.analysisHeading}>Siste genererte pakke</Text>

          {(typeof applicationPackage?.pdfUrl === 'string' && applicationPackage.pdfUrl.trim()) ? (
            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 0 }]}
              onPress={() => openDocument(applicationPackage.pdfUrl)}
            >
              <Text style={styles.secondaryButtonText}>Åpne PDF</Text>
            </TouchableOpacity>
          ) : null}

          {(typeof applicationPackage?.coverLetter === 'string' && applicationPackage.coverLetter.trim()) ? (
            <>
              <Text style={styles.analysisSubheading}>Søknad</Text>
              <Text style={styles.analysisList}>{applicationPackage.coverLetter}</Text>
            </>
          ) : null}

          {(typeof applicationPackage?.cv === 'string' && applicationPackage.cv.trim()) ? (
            <>
              <Text style={styles.analysisSubheading}>CV</Text>
              <Text style={styles.analysisList}>{applicationPackage.cv}</Text>
            </>
          ) : null}

          {(
            (!applicationPackage?.coverLetter || !String(applicationPackage.coverLetter).trim())
            && (!applicationPackage?.cv || !String(applicationPackage.cv).trim())
          ) ? (
            <Text style={styles.helpText}>Ingen tekst å vise.</Text>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity style={styles.secondaryButton} onPress={loadDocuments}>
        <Text style={styles.secondaryButtonText}>{documentsLoading ? 'Laster...' : 'Oppdater'}</Text>
      </TouchableOpacity>

      {!documentsLoading && documents.length === 0 ? (
        <Text style={[styles.helpText, { marginTop: 12 }]}>Ingen dokumenter ennå. Bruk "Send søknad" på Analyse-siden for å generere PDF.</Text>
      ) : null}

      {documents.map((doc) => (
        <View key={doc.id} style={styles.messageCard}>
          <Text style={styles.messageTitle}>{doc?.job?.title || 'Søknad'}</Text>
          <Text style={styles.messageText}>{doc?.job?.company || 'Ukjent bedrift'}</Text>

          <TouchableOpacity
            style={[styles.secondaryButton, { marginTop: 10, paddingVertical: 12 }]}
            onPress={() => openDocument(doc.cover_pdf_url)}
          >
            <Text style={styles.secondaryButtonText}>Åpne PDF (Søknad + CV)</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.secondaryButton, { marginTop: 8 }]}
        onPress={() => setActiveTab('profile')}
      >
        <Text style={styles.secondaryButtonText}>Tilbake til Profil</Text>
      </TouchableOpacity>
    </View>
  );
}
