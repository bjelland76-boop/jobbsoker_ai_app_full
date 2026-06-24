import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
  Switch, Modal, ScrollView, ActivityIndicator, Image, Linking, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '../context/AppContext';
import { useProfileContext } from '../context/ProfileContext';
import { PRIVACY_URL, DOC_TYPES } from '../hooks/useProfile';
import { styles } from '../styles/styles';
import { THEME } from '../styles/theme';
import { schoolOptions } from '../constants/options';

export default function ProfileScreen() {
  const { t, logout, deleteAccount, setActiveTab } = useApp();
  const {
    profileId,
    name, setName,
    profileEmail, setProfileEmail,
    phone, setPhone,
    address, setAddress,
    postalCode, setPostalCode,
    postalPlace, setPostalPlace,
    profilePhotoData, setProfilePhotoData,
    includePhotoDefault, setIncludePhotoDefault,
    includePhotoInPdf, setIncludePhotoInPdf,
    skills,
    skillInput, setSkillInput,
    skillsItems, setSkillsItems,
    consentAnalytics, setConsentAnalytics,
    languagesList, setLanguagesList,
    cvGapsList, setCvGapsList,
    savingProfile,
    autoSaveStatus,
    showSchoolListIndex, setShowSchoolListIndex,
    schoolFilter, setSchoolFilter,
    schoolKindFilter, setSchoolKindFilter,
    schoolResults,
    schoolResultsLoading,
    experienceEntries, setExperienceEntries,
    educationEntries, setEducationEntries,
    referenceEntries, setReferenceEntries,
    editingExperienceIndex, setEditingExperienceIndex,
    editingEducationIndex, setEditingEducationIndex,
    editingLanguageIndex, setEditingLanguageIndex,
    editingGapIndex, setEditingGapIndex,
    editingReferenceIndex, setEditingReferenceIndex,
    expandPersonCard, setExpandPersonCard,
    expandExpCard, setExpandExpCard,
    expandEduCard, setExpandEduCard,
    expandLangCard, setExpandLangCard,
    expandGapsCard, setExpandGapsCard,
    expandRefCard, setExpandRefCard,
    expandDocsCard, setExpandDocsCard,
    expandSkillsCard, setExpandSkillsCard,
    cvImportModalVisible, setCvImportModalVisible,
    cvImportLoading,
    cvImportPreview, setCvImportPreview,
    profileDocsList,
    docsUploading,
    showDocTypeModal, setShowDocTypeModal,
    setPendingDocFile,
    saveProfile,
    saveProfileAuto,
    pickAndUploadDocument,
    deleteProfileDocument,
    openDocumentPicker,
    pickProfilePhoto,
    importCvFromFile,
    importCvFromCamera,
    importCvFromGallery,
    applyCvImport,
  } = useProfileContext();

  const _initials = (name || '').trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('');
  const _skillsList = skills ? skills.split(',').map((s) => s.trim()).filter(Boolean) : [];
  let _strength = 0;
  if (name && name.trim() && name.trim() !== 'Ærlig JobbCoach') _strength += 10;
  if (profileEmail) _strength += 10;
  if (phone) _strength += 10;
  if (address) _strength += 10;
  if (profilePhotoData) _strength += 10;
  if (experienceEntries.length > 0) _strength += 20;
  if (educationEntries.length > 0) _strength += 15;
  if (_skillsList.length >= 3) _strength += 15;
  const _city = postalPlace || address || '—';
  const _visibleSkills = _skillsList.slice(0, 6);
  const _extraSkills = _skillsList.length - _visibleSkills.length;

  return (
    <View style={[styles.aerligHomeWrap, { backgroundColor: '#F7F5F0' }]}>
      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>Profil</Text>
        <Text style={styles.aerligPageSubtitle}>Personopplysninger, erfaring og referanser.</Text>

        {/* CV Import */}
        <TouchableOpacity
          style={[styles.aerligSecondaryButton, { marginBottom: 16, marginTop: 4 }]}
          onPress={() => setCvImportModalVisible(true)}
          disabled={cvImportLoading}
        >
          {cvImportLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={THEME.colors.primary} />
              <Text style={styles.aerligSecondaryButtonText}>Leser CV-en din...</Text>
            </View>
          ) : (
            <Text style={styles.aerligSecondaryButtonText}>Importer CV</Text>
          )}
        </TouchableOpacity>

        {cvImportModalVisible && <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setCvImportModalVisible(false)}
        >
          <View style={styles.cvModalOverlay}>
            <View style={styles.cvModalCard}>
              <Text style={styles.cvModalTitle}>Importer CV</Text>
              <Text style={styles.cvModalSubtitle}>Velg kilde</Text>
              <TouchableOpacity style={styles.aerligSecondaryButton} onPress={importCvFromFile}>
                <Text style={styles.aerligSecondaryButtonText}>Velg fil (PDF eller .docx)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 10 }]} onPress={importCvFromCamera}>
                <Text style={styles.aerligSecondaryButtonText}>Ta bilde av CV (kamera)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 10 }]} onPress={importCvFromGallery}>
                <Text style={styles.aerligSecondaryButtonText}>Velg bilde fra galleri</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.aerligDangerButton, { marginTop: 16 }]}
                onPress={() => setCvImportModalVisible(false)}
              >
                <Text style={styles.aerligDangerButtonText}>Avbryt</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>}

        {cvImportPreview && (
          <Modal
            visible={!!cvImportPreview}
            transparent
            animationType="slide"
            onRequestClose={() => setCvImportPreview(null)}
          >
            <View style={styles.cvModalOverlay}>
              <View style={[styles.cvModalCard, { maxHeight: '80%' }]}>
                <ScrollView>
                  <Text style={styles.cvModalTitle}>Hva vi fant i CV-en</Text>

                  {[
                    ['Navn', cvImportPreview.name],
                    ['E-post', cvImportPreview.email],
                    ['Telefon', cvImportPreview.phone],
                    ['Adresse', cvImportPreview.address],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <View key={label} style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{label}</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{value}</Text>
                    </View>
                  ))}

                  {Array.isArray(cvImportPreview.experience) && cvImportPreview.experience.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Erfaring ({cvImportPreview.experience.length} oppføringer)</Text>
                      {cvImportPreview.experience.map((e, i) => (
                        <View key={i} style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 8, marginTop: 4 }}>
                          <Text style={{ fontWeight: '600', fontSize: 13, color: '#111827' }}>{e.title || '—'}</Text>
                          <Text style={{ fontSize: 13, color: '#6B7280' }}>{e.company || ''}{e.from ? ` · ${e.from}–${e.current ? 'nå' : (e.to || '?')}` : ''}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.education) && cvImportPreview.education.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Utdanning ({cvImportPreview.education.length} oppføringer)</Text>
                      {cvImportPreview.education.map((e, i) => (
                        <View key={i} style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 8, marginTop: 4 }}>
                          <Text style={{ fontWeight: '600', fontSize: 13, color: '#111827' }}>{e.degree || '—'}</Text>
                          <Text style={{ fontSize: 13, color: '#6B7280' }}>{e.school || ''}{e.from ? ` · ${e.from}–${e.to || '?'}` : ''}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.skills) && cvImportPreview.skills.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Ferdigheter</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{cvImportPreview.skills.join(', ')}</Text>
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.languages) && cvImportPreview.languages.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>Språk</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{cvImportPreview.languages.join(', ')}</Text>
                    </View>
                  )}

                  <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 8 }]}>
                    Felter som allerede er fylt ut i profilen din vil ikke bli overskrevet.
                  </Text>
                </ScrollView>
                <TouchableOpacity
                  style={[styles.aerligPrimaryButton, { marginTop: 16 }]}
                  onPress={() => applyCvImport(cvImportPreview)}
                >
                  <Text style={styles.aerligPrimaryButtonText}>Importer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.aerligDangerButton, { marginTop: 10 }]}
                  onPress={() => setCvImportPreview(null)}
                >
                  <Text style={styles.aerligDangerButtonText}>Avbryt</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* Profile summary header */}
        <View style={styles.profileSummaryHeader}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{_initials || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileSummaryName}>{name || 'Navn'}</Text>
            <Text style={styles.profileSummaryStrengthLabel}>Profilstyrke: {_strength}%</Text>
            <View style={styles.profileStrengthTrack}>
              <View style={[styles.profileStrengthFill, { width: `${_strength}%` }]} />
            </View>
          </View>
        </View>

        {/* 2-col row: phone + location */}
        <View style={styles.profileCardRow}>
          <View style={styles.profileSummaryCard}>
            <Text style={styles.profileCardIcon}>📱</Text>
            <Text style={styles.profileCardLabel}>Telefon</Text>
            <Text style={styles.profileCardValue} numberOfLines={1}>{phone || '—'}</Text>
          </View>
          <View style={styles.profileSummaryCard}>
            <Text style={styles.profileCardIcon}>📍</Text>
            <Text style={styles.profileCardLabel}>Sted</Text>
            <Text style={styles.profileCardValue} numberOfLines={1}>{_city}</Text>
          </View>
        </View>

        {/* Personopplysninger accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandPersonCard((v) => !v)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>👤</Text>
              <View>
                <Text style={styles.profileCardLabel}>Personopplysninger</Text>
                <Text style={styles.profileCardValue} numberOfLines={1}>{name || 'Ikke utfylt'}</Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandPersonCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandPersonCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Navn</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={name} onChangeText={setName} placeholder="Navn" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>E-post</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={profileEmail} onChangeText={setProfileEmail} placeholder="E-post" autoCapitalize="none" keyboardType="email-address" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Telefon</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={phone} onChangeText={setPhone} placeholder="Telefon" keyboardType="phone-pad" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Adresse</Text>
              <TextInput
                style={[styles.input, styles.aerligInput]}
                value={address}
                onChangeText={setAddress}
                placeholder="Gateadresse"
                autoCapitalize="words"
              />

              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.aerligInput, styles.inlineInput]}
                  value={postalCode}
                  onChangeText={setPostalCode}
                  placeholder="Postnr"
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.aerligInput, styles.inlineInput, { marginRight: 0 }]}
                  value={postalPlace}
                  onChangeText={setPostalPlace}
                  placeholder="Poststed"
                  autoCapitalize="words"
                />
              </View>

              <Text style={[styles.inputLabel, styles.aerligLabel]}>Profilbilde (valgfritt)</Text>
              {profilePhotoData ? (
                <View style={{ alignItems: 'center', marginBottom: 10 }}>
                  <Image
                    source={{ uri: profilePhotoData }}
                    style={{ width: 110, height: 110, borderRadius: 16, marginBottom: 10 }}
                  />
                  <TouchableOpacity
                    style={[styles.aerligSecondaryButton, { marginTop: 0, paddingVertical: 12, width: '100%' }]}
                    onPress={() => {
                      setProfilePhotoData('');
                      if (profileId) saveProfile({ silent: true, override: { photo_data: '' } });
                    }}
                  >
                    <Text style={styles.aerligSecondaryButtonText}>Fjern bilde</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 0, paddingVertical: 12 }]} onPress={pickProfilePhoto}>
                <Text style={styles.aerligSecondaryButtonText}>{profilePhotoData ? 'Bytt bilde' : 'Velg bilde'}</Text>
              </TouchableOpacity>
              <Text style={[styles.helpText, styles.aerligHelpText]}>Du kan velge om bildet skal være med i hver PDF når du lager søknad.</Text>
              {profilePhotoData ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.inputLabel, styles.aerligLabel]}>Bilde i PDF som standard</Text>
                  <Text style={[styles.helpText, styles.aerligHelpText]}>Dette blir standardvalget hver gang du lager ny søknad/PDF (kan overstyres per søknad).</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.messageText, styles.aerligMessageText]}>{includePhotoDefault ? 'På' : 'Av'}</Text>
                    <Switch
                      value={includePhotoDefault}
                      onValueChange={(v) => {
                        setIncludePhotoDefault(!!v);
                        setIncludePhotoInPdf(!!v);
                        if (profileId) saveProfile({ silent: true, override: { include_photo_default: !!v } });
                      }}
                    />
                  </View>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.aerligPrimaryButton, { marginTop: 16 }]}
                onPress={() => { setExpandPersonCard(false); saveProfile(); }}
              >
                <Text style={styles.aerligPrimaryButtonText}>Lagre</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Experience accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandExpCard((v) => {
              const next = !v;
              if (!next) setEditingExperienceIndex(-1);
              return next;
            })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>💼</Text>
              <View>
                <Text style={styles.profileCardLabel}>Erfaring</Text>
                <Text style={styles.profileCardValue}>
                  {experienceEntries.length > 0 ? `${experienceEntries.length} stilling${experienceEntries.length === 1 ? '' : 'er'}` : 'Ingen lagt til'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandExpCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandExpCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              {experienceEntries.map((entry, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{entry.title || 'Stillingstittel'}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{entry.company || 'Arbeidsgiver'}</Text>
                    </View>
                    <Text style={styles.aerligEntryYears} numberOfLines={1}>
                      {`${(entry.from || '—').trim() || '—'}–${entry.current ? 'nå' : (((entry.to || '—').trim()) || '—')}`}
                    </Text>
                  </View>

                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingExperienceIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingExperienceIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setExperienceEntries((prev) => (prev || []).filter((_, i) => i !== index));
                        setEditingExperienceIndex((cur) => {
                          if (cur === index) return -1;
                          if (cur > index) return cur - 1;
                          return cur;
                        });
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>

                  {editingExperienceIndex === index ? (
                    <>
                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 8 }]}
                          value={entry.title}
                          placeholder="Stillingstittel"
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].title = value;
                            setExperienceEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 0 }]}
                          value={entry.company}
                          placeholder="Arbeidsgiver"
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].company = value;
                            setExperienceEntries(items);
                          }}
                        />
                      </View>

                      <View style={[styles.aerligEntryEditRow, { alignItems: 'center', marginBottom: 8 }]}>
                        <TouchableOpacity
                          style={[styles.checkbox, styles.aerligCheckbox, { marginLeft: 0 }, entry.current && styles.aerligCheckboxOn]}
                          onPress={() => {
                            const items = [...experienceEntries];
                            const next = !items[index].current;
                            items[index].current = next;
                            if (next) items[index].to = '';
                            setExperienceEntries(items);
                          }}
                        >
                          <Text style={[styles.checkboxText, styles.aerligCheckboxText, entry.current && styles.aerligCheckboxTextOn]}>{entry.current ? '✓' : ''}</Text>
                        </TouchableOpacity>
                        <Text style={styles.aerligInlineNote}>Jobber her fremdeles</Text>
                      </View>

                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                          value={entry.from || ''}
                          placeholder="Fra (år/mnd)"
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].from = value;
                            setExperienceEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0 }, entry.current && { opacity: 0.6 }]}
                          value={entry.current ? 'Nå' : (entry.to || '')}
                          placeholder={entry.current ? 'Nå' : 'Til (år/mnd)'}
                          editable={!entry.current}
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].to = value;
                            setExperienceEntries(items);
                          }}
                        />
                      </View>
                    </>
                  ) : null}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...(experienceEntries || []), { title: '', company: '', from: '', to: '', current: false }];
                  setExperienceEntries(next);
                  setEditingExperienceIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til erfaring</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Education accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandEduCard((v) => {
              const next = !v;
              if (!next) {
                setEditingEducationIndex(-1);
                setShowSchoolListIndex(-1);
                setSchoolFilter('');
              }
              return next;
            })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>🎓</Text>
              <View>
                <Text style={styles.profileCardLabel}>Utdanning</Text>
                <Text style={styles.profileCardValue}>
                  {educationEntries.length > 0 ? `${educationEntries.length} grad${educationEntries.length === 1 ? '' : 'er'}` : 'Ingen lagt til'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandEduCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandEduCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              {educationEntries.map((entry, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{entry.school || 'Skole'}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{entry.degree || 'Studie/program'}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.aerligEntryYears} numberOfLines={1}>
                        {entry.status === 'pagaende'
                          ? `${(entry.from || '—').trim() || '—'}–pågår`
                          : `${(entry.from || '—').trim() || '—'}–${((entry.to || '—').trim()) || '—'}`}
                      </Text>
                      {entry.status === 'pagaende'
                        ? <Text style={{ fontSize: 10, color: '#E8501A', fontWeight: '600', marginTop: 1 }}>Pågående</Text>
                        : <Text style={{ fontSize: 10, color: '#16a34a', fontWeight: '600', marginTop: 1 }}>Fullført</Text>
                      }
                    </View>
                  </View>

                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => {
                        setEditingEducationIndex((cur) => (cur === index ? -1 : index));
                        setShowSchoolListIndex(-1);
                        setSchoolFilter('');
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingEducationIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setEducationEntries((prev) => (prev || []).filter((_, i) => i !== index));
                        setEditingEducationIndex((cur) => {
                          if (cur === index) return -1;
                          if (cur > index) return cur - 1;
                          return cur;
                        });
                        setShowSchoolListIndex((cur) => {
                          if (cur === index) return -1;
                          if (cur > index) return cur - 1;
                          return cur;
                        });
                        if (showSchoolListIndex === index) setSchoolFilter('');
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>

                  {editingEducationIndex === index ? (
                    <>
                      <View style={styles.aerligEntryEditRow}>
                        <TouchableOpacity
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 8 }]}
                          onPress={() => {
                            setShowSchoolListIndex(index);
                            setSchoolFilter('');
                            setSchoolKindFilter('all');
                          }}
                        >
                          <Text style={entry.school ? styles.aerligInputText : styles.aerligPlaceholderText}>
                            {entry.school || 'Velg skole'}
                          </Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 0 }]}
                          value={entry.degree}
                          placeholder="Grad / studieretning"
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].degree = value;
                            setEducationEntries(items);
                          }}
                        />
                      </View>

                      {showSchoolListIndex === index && (
                        <View style={[styles.dropdownList, styles.aerligDropdownList]}>
                          <TextInput
                            style={[styles.input, styles.aerligInput, { margin: 8 }]}
                            placeholder="Søk: videregående, universitet eller nettskole..."
                            value={schoolFilter}
                            onChangeText={setSchoolFilter}
                            autoCapitalize="words"
                          />
                          <View style={[styles.filterChipRow, styles.aerligFilterChipRow]}>
                            {[
                              { key: 'all', label: 'Alle' },
                              { key: 'vgs', label: 'VGS' },
                              { key: 'universitet', label: 'Uni/høyskole' },
                              { key: 'nettskole', label: 'Nettskole' },
                            ].map((item) => {
                              const active = schoolKindFilter === item.key;
                              return (
                                <TouchableOpacity
                                  key={item.key}
                                  style={[styles.filterChip, styles.aerligFilterChip, active && styles.aerligFilterChipActive]}
                                  onPress={() => setSchoolKindFilter(item.key)}
                                >
                                  <Text style={[styles.filterChipText, styles.aerligFilterChipText, active && styles.aerligFilterChipTextActive]}>{item.label}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          {schoolFilter.trim().length < 2 ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>Skriv minst 2 bokstaver for forslag.</Text>
                          ) : null}
                          {schoolResultsLoading ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>Laster skoler...</Text>
                          ) : null}
                          {!schoolResultsLoading && schoolFilter.trim().length >= 2 && (
                            (schoolResults.length === 0 &&
                              schoolOptions.filter((s) => s.toLowerCase().includes(schoolFilter.toLowerCase())).length === 0)
                          ) ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>Ingen treff.</Text>
                          ) : null}
                          {(schoolFilter.trim().length >= 2
                            ? (schoolResults.length > 0
                                ? schoolResults
                                : schoolOptions
                                    .filter((s) => s.toLowerCase().includes(schoolFilter.toLowerCase()))
                                    .map((name) => ({ name, kind: 'lokal', kommune: null })))
                            : [])
                            .map((option) => (
                              <TouchableOpacity
                                key={option.name}
                                style={styles.dropdownItem}
                                onPress={() => {
                                  const items = [...educationEntries];
                                  items[index].school = option.name;
                                  setEducationEntries(items);
                                  setShowSchoolListIndex(-1);
                                  setSchoolFilter('');
                                }}
                              >
                                <Text style={[styles.dropdownItemText, styles.aerligDropdownItemText]}>{option.name}</Text>
                                {option.kind || option.kommune ? (
                                  <Text style={[styles.dropdownItemSub, styles.aerligDropdownItemSub]}>
                                    {[option.kind, option.kommune].filter(Boolean).join(' • ')}
                                  </Text>
                                ) : null}
                              </TouchableOpacity>
                            ))}
                        </View>
                      )}

                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                          value={entry.from}
                          placeholder="Fra (år/mnd)"
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].from = value;
                            setEducationEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0 }]}
                          value={entry.to}
                          placeholder="Til (år/mnd)"
                          editable={entry.status !== 'pagaende'}
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].to = value;
                            setEducationEntries(items);
                          }}
                        />
                      </View>

                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        {[
                          { key: 'fullfort', label: 'Fullført', activeColor: '#16a34a' },
                          { key: 'pagaende', label: 'Pågående', activeColor: '#E8501A' },
                        ].map(({ key, label, activeColor }) => {
                          const isActive = entry.status === key;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={[styles.filterChip, styles.aerligFilterChip, isActive && { backgroundColor: activeColor, borderColor: activeColor }]}
                              onPress={() => {
                                const items = [...educationEntries];
                                items[index] = { ...items[index], status: key };
                                setEducationEntries(items);
                              }}
                            >
                              <Text style={[styles.filterChipText, styles.aerligFilterChipText, isActive && { color: '#FFFFFF' }]}>{label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  ) : null}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...(educationEntries || []), { school: '', degree: '', from: '', to: '', status: 'fullfort' }];
                  setEducationEntries(next);
                  setEditingEducationIndex(next.length - 1);
                  setShowSchoolListIndex(-1);
                  setSchoolFilter('');
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til utdanning</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Skills card with inline edit */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 20 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: _skillsList.length > 0 ? 8 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>⚡</Text>
              <Text style={[styles.profileCardLabel, { marginBottom: 0 }]}>Ferdigheter</Text>
            </View>
            <TouchableOpacity onPress={() => setExpandSkillsCard((v) => !v)}>
              <Text style={{ fontSize: 12, color: '#E8501A', fontWeight: '500' }}>{expandSkillsCard ? 'Lukk' : 'Rediger'}</Text>
            </TouchableOpacity>
          </View>
          {_skillsList.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: expandSkillsCard ? 12 : 0 }}>
              {_visibleSkills.map((s, i) => (
                <View key={i} style={styles.profileSkillChip}>
                  <Text style={styles.profileSkillChipText}>{s}</Text>
                </View>
              ))}
              {_extraSkills > 0 && (
                <View style={[styles.profileSkillChip, styles.profileSkillChipExtra]}>
                  <Text style={[styles.profileSkillChipText, { color: '#6B7280' }]}>+{_extraSkills} til</Text>
                </View>
              )}
            </View>
          )}
          {expandSkillsCard && (
            <View>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {skillsItems.map((item, i) => (
                  <TouchableOpacity
                    key={`${item}-${i}`}
                    style={[styles.profileSkillChip, { flexDirection: 'row', alignItems: 'center' }]}
                    onPress={() => setSkillsItems(skillsItems.filter((_, idx) => idx !== i))}
                  >
                    <Text style={styles.profileSkillChipText}>{item} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.input, styles.aerligInput, { flex: 1, marginBottom: 0 }]}
                  value={skillInput}
                  onChangeText={setSkillInput}
                  placeholder="Ny ferdighet"
                  autoCapitalize="sentences"
                />
                <TouchableOpacity
                  style={[styles.aerligSecondaryButton, { marginTop: 0, paddingHorizontal: 16 }]}
                  onPress={() => {
                    const v = String(skillInput || '').trim();
                    if (!v) return;
                    const exists = skillsItems.some((it) => String(it).toLowerCase() === v.toLowerCase());
                    if (!exists) setSkillsItems([...skillsItems, v]);
                    setSkillInput('');
                  }}
                >
                  <Text style={styles.aerligSecondaryButtonText}>Legg til</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Språk accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandLangCard((v) => { const n = !v; if (!n) setEditingLanguageIndex(-1); return n; })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>🗣️</Text>
              <View>
                <Text style={styles.profileCardLabel}>Språk</Text>
                <Text style={styles.profileCardValue}>
                  {languagesList.length > 0 ? `${languagesList.length} språk` : 'Ikke utfylt'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandLangCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandLangCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />
              {languagesList.map((lang, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{lang.name || 'Språk'}</Text>
                      {lang.level ? <Text style={styles.aerligEntrySub} numberOfLines={1}>{lang.level}</Text> : null}
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingLanguageIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingLanguageIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setLanguagesList((prev) => prev.filter((_, i) => i !== index));
                        setEditingLanguageIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                  {editingLanguageIndex === index && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={lang.name}
                        placeholder="Språk (f.eks. Norsk)"
                        autoCapitalize="words"
                        onChangeText={(v) => {
                          const items = [...languagesList];
                          items[index] = { ...items[index], name: v };
                          setLanguagesList(items);
                        }}
                      />
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {['Nybegynner', 'Grunnleggende', 'Godt', 'Flytende', 'Morsmål'].map((lvl) => (
                          <TouchableOpacity
                            key={lvl}
                            style={[styles.filterChip, styles.aerligFilterChip, lang.level === lvl && styles.aerligFilterChipActive]}
                            onPress={() => {
                              const items = [...languagesList];
                              items[index] = { ...items[index], level: lang.level === lvl ? '' : lvl };
                              setLanguagesList(items);
                            }}
                          >
                            <Text style={[styles.filterChipText, styles.aerligFilterChipText, lang.level === lvl && styles.aerligFilterChipTextActive]}>{lvl}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...languagesList, { name: '', level: '' }];
                  setLanguagesList(next);
                  setEditingLanguageIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til språk</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Hull i CV accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandGapsCard((v) => { const n = !v; if (!n) setEditingGapIndex(-1); return n; })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>📅</Text>
              <View>
                <Text style={styles.profileCardLabel}>Hull i CV</Text>
                <Text style={styles.profileCardValue}>
                  {cvGapsList.length > 0 ? `${cvGapsList.length} periode${cvGapsList.length === 1 ? '' : 'r'}` : 'Ingen registrert'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandGapsCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandGapsCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 8 }} />
              <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 12 }]}>
                Hull i CV brukes til å forklare perioder uten arbeidserfaring i søknaden din.
              </Text>
              {cvGapsList.map((gap, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>
                        {gap.from ? (gap.to ? `${gap.from}–${gap.to}` : gap.from) : 'Periode'}
                      </Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={2}>{gap.description || 'Forklaring'}</Text>
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingGapIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingGapIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setCvGapsList((prev) => prev.filter((_, i) => i !== index));
                        setEditingGapIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                  {editingGapIndex === index && (
                    <View style={styles.aerligEntryEditRow}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                        value={gap.from}
                        placeholder="Fra (år)"
                        keyboardType="numeric"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], from: v }; setCvGapsList(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                        value={gap.to}
                        placeholder="Til (år)"
                        keyboardType="numeric"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], to: v }; setCvGapsList(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0, flex: 2 }]}
                        value={gap.description}
                        placeholder="Forklaring"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], description: v }; setCvGapsList(items); }}
                      />
                    </View>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...cvGapsList, { from: '', to: '', description: '' }];
                  setCvGapsList(next);
                  setEditingGapIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til periode</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Referanser accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandRefCard((v) => { const n = !v; if (!n) setEditingReferenceIndex(-1); return n; })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>👥</Text>
              <View>
                <Text style={styles.profileCardLabel}>Referanser</Text>
                <Text style={styles.profileCardValue}>
                  {referenceEntries.length > 0 ? `${referenceEntries.length} referanse${referenceEntries.length === 1 ? '' : 'r'}` : 'Ikke utfylt'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandRefCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandRefCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 8 }} />
              <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 12 }]}>
                Referanser kan inkluderes automatisk i søknaden din.
              </Text>
              {referenceEntries.map((ref, index) => (
                <View key={index} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{ref.name || 'Navn'}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{ref.relation || ref.title || ''}</Text>
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingReferenceIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingReferenceIndex === index ? 'Ferdig' : 'Rediger'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setReferenceEntries((prev) => prev.filter((_, i) => i !== index));
                        setEditingReferenceIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                  {editingReferenceIndex === index && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.name}
                        placeholder="Navn"
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], name: v }; setReferenceEntries(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.relation || ''}
                        placeholder="Stilling / tittel (f.eks. Leder i X)"
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], relation: v }; setReferenceEntries(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.contact || ''}
                        placeholder="Telefon eller e-post"
                        autoCapitalize="none"
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], contact: v }; setReferenceEntries(items); }}
                      />
                    </View>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton]}
                onPress={() => {
                  const next = [...(referenceEntries || []), { name: '', relation: '', contact: '' }];
                  setReferenceEntries(next);
                  setEditingReferenceIndex(next.length - 1);
                }}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>+ Legg til referanse</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Dokumenter accordion card */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 12 }]}>
          <TouchableOpacity
            onPress={() => setExpandDocsCard((v) => !v)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>📄</Text>
              <View>
                <Text style={styles.profileCardLabel}>Dokumenter</Text>
                <Text style={styles.profileCardValue}>
                  {profileDocsList.length > 0 ? `${profileDocsList.length} dokument${profileDocsList.length === 1 ? '' : 'er'}` : 'Ingen opplastet'}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandDocsCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandDocsCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 8 }} />
              <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 12 }]}>
                Last opp fagbrev, kursbevis, karakterutskrifter og lignende. Teksten brukes automatisk når AI-en lager søknadsbrev og CV.
              </Text>
              {profileDocsList.map((doc) => (
                <View key={doc.id} style={[styles.aerligCard, styles.aerligListRow]}>
                  <View style={[styles.aerligEntryHeader, styles.aerligListRowHeader]}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{doc.filename}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{doc.document_type}</Text>
                    </View>
                  </View>
                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => deleteProfileDocument(doc.id)}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>Fjern</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={[styles.smallButton, styles.aerligSmallButton, docsUploading && { opacity: 0.5 }]}
                onPress={openDocumentPicker}
                disabled={docsUploading}
              >
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>
                  {docsUploading ? 'Laster opp...' : '+ Last opp dokument'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {showDocTypeModal && (
          <Modal visible transparent animationType="fade" onRequestClose={() => { setShowDocTypeModal(false); setPendingDocFile(null); }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <View style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 16 }}>Velg dokumenttype</Text>
                {DOC_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.aerligPrimaryButton, { marginBottom: 10 }]}
                    onPress={() => pickAndUploadDocument(type)}
                  >
                    <Text style={styles.aerligPrimaryButtonText}>{type}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.aerligSecondaryButton}
                  onPress={() => { setShowDocTypeModal(false); setPendingDocFile(null); }}
                >
                  <Text style={styles.aerligSecondaryButtonText}>Avbryt</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>Anonym statistikk</Text>
          <Text style={[styles.helpText, styles.aerligHelpText]}>Hjelper oss å se om appen faktisk øker sjansen for intervju og jobb. Vi bruker kun status (søkt/intervju/fikk jobb), ikke navn eller kontaktinfo.</Text>
          <TouchableOpacity
            style={{ marginBottom: 10 }}
            onPress={async () => {
              try {
                await Linking.openURL(PRIVACY_URL);
              } catch (e) {
                Alert.alert('Lenke', PRIVACY_URL);
              }
            }}
          >
            <Text style={styles.aerligLinkText}>{t('privacyLink')}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.messageText, styles.aerligMessageText]}>{consentAnalytics ? 'På' : 'Av'}</Text>
            <Switch
              value={consentAnalytics}
              onValueChange={async (v) => {
                setConsentAnalytics(v);
                try {
                  await AsyncStorage.setItem('analyticsConsentPrompted', 'yes');
                } catch (e) {
                  // ignore
                }
                if (profileId) {
                  saveProfile({ silent: true, override: { consent_analytics: v } });
                }
              }}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => setActiveTab('documents')}>
          <Text style={styles.aerligSecondaryButtonText}>Dokumenter</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => setActiveTab('settings')}>
          <Text style={styles.aerligSecondaryButtonText}>E-postinnstillinger</Text>
        </TouchableOpacity>

        {/* Autosave status */}
        <View style={styles.autoSaveBar}>
          {autoSaveStatus === 'pending' && (
            <Text style={styles.autoSaveText}>Venter på lagring...</Text>
          )}
          {autoSaveStatus === 'saving' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color={THEME.colors.primary} />
              <Text style={styles.autoSaveText}>Lagrer...</Text>
            </View>
          )}
          {autoSaveStatus === 'saved' && (
            <Text style={[styles.autoSaveText, { color: '#16a34a' }]}>Lagret ✓</Text>
          )}
          {autoSaveStatus === 'error' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[styles.autoSaveText, { color: '#dc2626' }]}>Kunne ikke lagre</Text>
              <TouchableOpacity onPress={saveProfileAuto}>
                <Text style={[styles.autoSaveText, { color: THEME.colors.primary, fontWeight: '600' }]}>Prøv igjen</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ marginTop: 32, gap: 12 }}>
          <TouchableOpacity
            style={[styles.aerligPrimaryButton, { width: '100%' }]}
            onPress={saveProfile}
          >
            <Text style={styles.aerligPrimaryButtonText}>{savingProfile ? 'Lagrer...' : 'Lagre nå'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              width: '100%',
              minHeight: 50,
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#FFFFFF',
              borderWidth: 1.5,
              borderColor: '#E8501A',
            }}
            onPress={logout}
          >
            <Text style={{ color: '#E8501A', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 }}>Logg ut</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ alignItems: 'center', paddingVertical: 12 }}
            onPress={deleteAccount}
          >
            <Text style={{ color: '#999999', fontSize: 13 }}>Slett konto og data</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
