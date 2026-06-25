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
  const { setActiveTab, t } = useApp();

  return (
    <View style={styles.pageCard}>
      <Pressable
        android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
        style={styles.aerligBackButton}
        onPress={() => setActiveTab('home')}
      >
        <Text style={styles.aerligBackButtonText}>{t('common.back')}</Text>
      </Pressable>
      <Text style={styles.pageTitle}>{t('documents.title')}</Text>
      <Text style={styles.pageSubtitle}>{t('documents.subtitle')}</Text>

      {applicationPackage ? (
        <View style={styles.analysisCard}>
          <Text style={styles.analysisHeading}>{t('documents.latest_package')}</Text>

          {(typeof applicationPackage?.pdfUrl === 'string' && applicationPackage.pdfUrl.trim()) ? (
            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 0 }]}
              onPress={() => openDocument(applicationPackage.pdfUrl)}
            >
              <Text style={styles.secondaryButtonText}>{t('documents.open_pdf')}</Text>
            </TouchableOpacity>
          ) : null}

          {(typeof applicationPackage?.coverLetter === 'string' && applicationPackage.coverLetter.trim()) ? (
            <>
              <Text style={styles.analysisSubheading}>{t('documents.cover_letter')}</Text>
              <Text style={styles.analysisList}>{applicationPackage.coverLetter}</Text>
            </>
          ) : null}

          {(typeof applicationPackage?.cv === 'string' && applicationPackage.cv.trim()) ? (
            <>
              <Text style={styles.analysisSubheading}>{t('documents.cv')}</Text>
              <Text style={styles.analysisList}>{applicationPackage.cv}</Text>
            </>
          ) : null}

          {(
            (!applicationPackage?.coverLetter || !String(applicationPackage.coverLetter).trim())
            && (!applicationPackage?.cv || !String(applicationPackage.cv).trim())
          ) ? (
            <Text style={styles.helpText}>{t('documents.no_text')}</Text>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity style={styles.secondaryButton} onPress={loadDocuments}>
        <Text style={styles.secondaryButtonText}>{documentsLoading ? t('documents.loading') : t('documents.update')}</Text>
      </TouchableOpacity>

      {!documentsLoading && documents.length === 0 ? (
        <Text style={[styles.helpText, { marginTop: 12 }]}>{t('documents.no_documents')}</Text>
      ) : null}

      {documents.map((doc) => (
        <View key={doc.id} style={styles.messageCard}>
          <Text style={styles.messageTitle}>{doc?.job?.title || t('documents.unknown_application')}</Text>
          <Text style={styles.messageText}>{doc?.job?.company || t('common.unknown_company')}</Text>

          <TouchableOpacity
            style={[styles.secondaryButton, { marginTop: 10, paddingVertical: 12 }]}
            onPress={() => openDocument(doc.cover_pdf_url)}
          >
            <Text style={styles.secondaryButtonText}>{t('documents.open_pdf_full')}</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.secondaryButton, { marginTop: 8 }]}
        onPress={() => setActiveTab('profile')}
      >
        <Text style={styles.secondaryButtonText}>{t('documents.back_to_profile')}</Text>
      </TouchableOpacity>
    </View>
  );
}
