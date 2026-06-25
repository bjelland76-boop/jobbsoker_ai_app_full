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
  const { t, logout, deleteAccount, setActiveTab, uiLanguage, setAndPersistUiLanguage } = useApp();
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
        <Text style={styles.aerligPageTitle}>{t('profile.title')}</Text>
        <Text style={styles.aerligPageSubtitle}>{t('profile.subtitle')}</Text>

        {/* CV Import */}
        <TouchableOpacity
          style={[styles.aerligSecondaryButton, { marginBottom: 16, marginTop: 4 }]}
          onPress={() => setCvImportModalVisible(true)}
          disabled={cvImportLoading}
        >
          {cvImportLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={THEME.colors.primary} />
              <Text style={styles.aerligSecondaryButtonText}>{t('profile.reading_cv')}</Text>
            </View>
          ) : (
            <Text style={styles.aerligSecondaryButtonText}>{t('profile.import_cv')}</Text>
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
              <Text style={styles.cvModalTitle}>{t('profile.import_cv_title')}</Text>
              <Text style={styles.cvModalSubtitle}>{t('profile.import_cv_subtitle')}</Text>
              <TouchableOpacity style={styles.aerligSecondaryButton} onPress={importCvFromFile}>
                <Text style={styles.aerligSecondaryButtonText}>{t('profile.choose_file')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 10 }]} onPress={importCvFromCamera}>
                <Text style={styles.aerligSecondaryButtonText}>{t('profile.take_photo')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 10 }]} onPress={importCvFromGallery}>
                <Text style={styles.aerligSecondaryButtonText}>{t('profile.choose_gallery')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.aerligDangerButton, { marginTop: 16 }]}
                onPress={() => setCvImportModalVisible(false)}
              >
                <Text style={styles.aerligDangerButtonText}>{t('common.cancel')}</Text>
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
                  <Text style={styles.cvModalTitle}>{t('profile.found_in_cv')}</Text>

                  {[
                    [t('profile.name_label'), cvImportPreview.name],
                    [t('profile.email_label'), cvImportPreview.email],
                    [t('profile.phone_label'), cvImportPreview.phone],
                    [t('profile.address_label'), cvImportPreview.address],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <View key={label} style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{label}</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{value}</Text>
                    </View>
                  ))}

                  {Array.isArray(cvImportPreview.experience) && cvImportPreview.experience.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.experience_count', { count: cvImportPreview.experience.length })}</Text>
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
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.education_count', { count: cvImportPreview.education.length })}</Text>
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
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.skills_label')}</Text>
                      <Text style={{ color: '#374151', fontSize: 14, lineHeight: 20 }}>{cvImportPreview.skills.join(', ')}</Text>
                    </View>
                  )}

                  {Array.isArray(cvImportPreview.languages) && cvImportPreview.languages.length > 0 && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.languages_label')}</Text>
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
                  <Text style={styles.aerligPrimaryButtonText}>{t('profile.import_btn')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.aerligDangerButton, { marginTop: 10 }]}
                  onPress={() => setCvImportPreview(null)}
                >
                  <Text style={styles.aerligDangerButtonText}>{t('common.cancel')}</Text>
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
            <Text style={styles.profileSummaryStrengthLabel}>{t('profile.profile_strength', { percent: _strength })}</Text>
            <View style={styles.profileStrengthTrack}>
              <View style={[styles.profileStrengthFill, { width: `${_strength}%` }]} />
            </View>
          </View>
        </View>

        {/* 2-col row: phone + location */}
        <View style={styles.profileCardRow}>
          <View style={styles.profileSummaryCard}>
            <Text style={styles.profileCardIcon}>📱</Text>
            <Text style={styles.profileCardLabel}>{t('profile.phone_label')}</Text>
            <Text style={styles.profileCardValue} numberOfLines={1}>{phone || '—'}</Text>
          </View>
          <View style={styles.profileSummaryCard}>
            <Text style={styles.profileCardIcon}>📍</Text>
            <Text style={styles.profileCardLabel}>{t('profile.location_label')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.personal_info')}</Text>
                <Text style={styles.profileCardValue} numberOfLines={1}>{name || t('profile.not_filled')}</Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>{expandPersonCard ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {expandPersonCard && (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 1, backgroundColor: '#E8E6E0', marginBottom: 12 }} />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.name_label')}</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={name} onChangeText={setName} placeholder={t('profile.name_label')} />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.email_label')}</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={profileEmail} onChangeText={setProfileEmail} placeholder={t('profile.email_label')} autoCapitalize="none" keyboardType="email-address" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.phone_label')}</Text>
              <TextInput style={[styles.input, styles.aerligInput]} value={phone} onChangeText={setPhone} placeholder={t('profile.phone_label')} keyboardType="phone-pad" />

              <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.address_label')}</Text>
              <TextInput
                style={[styles.input, styles.aerligInput]}
                value={address}
                onChangeText={setAddress}
                placeholder={t('profile.street_placeholder')}
                autoCapitalize="words"
              />

              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.aerligInput, styles.inlineInput]}
                  value={postalCode}
                  onChangeText={setPostalCode}
                  placeholder={t('profile.zip_placeholder')}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.aerligInput, styles.inlineInput, { marginRight: 0 }]}
                  value={postalPlace}
                  onChangeText={setPostalPlace}
                  placeholder={t('profile.city_placeholder')}
                  autoCapitalize="words"
                />
              </View>

              <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.photo_label')}</Text>
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
                    <Text style={styles.aerligSecondaryButtonText}>{t('profile.remove_photo')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.aerligSecondaryButton, { marginTop: 0, paddingVertical: 12 }]} onPress={pickProfilePhoto}>
                <Text style={styles.aerligSecondaryButtonText}>{profilePhotoData ? t('profile.change_photo') : t('profile.add_photo')}</Text>
              </TouchableOpacity>
              <Text style={[styles.helpText, styles.aerligHelpText]}>{t('profile.photo_help')}</Text>
              {profilePhotoData ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.photo_in_pdf_label')}</Text>
                  <Text style={[styles.helpText, styles.aerligHelpText]}>{t('profile.photo_in_pdf_help')}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.messageText, styles.aerligMessageText]}>{includePhotoDefault ? t('common.on') : t('common.off')}</Text>
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
                <Text style={styles.aerligPrimaryButtonText}>{t('profile.save_btn')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.experience_title')}</Text>
                <Text style={styles.profileCardValue}>
                  {experienceEntries.length > 0 ? `${experienceEntries.length}` : t('profile.no_experience')}
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
                      <Text style={styles.aerligEntryTitle} numberOfLines={1}>{entry.title || t('profile.job_title_placeholder')}</Text>
                      <Text style={styles.aerligEntrySub} numberOfLines={1}>{entry.company || t('profile.employer_placeholder')}</Text>
                    </View>
                    <Text style={styles.aerligEntryYears} numberOfLines={1}>
                      {`${(entry.from || '—').trim() || '—'}–${entry.current ? t('profile.now') : (((entry.to || '—').trim()) || '—')}`}
                    </Text>
                  </View>

                  <View style={styles.aerligRowActions}>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip]}
                      onPress={() => setEditingExperienceIndex((cur) => (cur === index ? -1 : index))}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText]}>
                        {editingExperienceIndex === index ? t('common.done') : t('common.edit')}
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
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>{t('common.remove')}</Text>
                    </TouchableOpacity>
                  </View>

                  {editingExperienceIndex === index ? (
                    <>
                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 8 }]}
                          value={entry.title}
                          placeholder={t('profile.job_title_placeholder')}
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].title = value;
                            setExperienceEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 0 }]}
                          value={entry.company}
                          placeholder={t('profile.employer_placeholder')}
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
                        <Text style={styles.aerligInlineNote}>{t('profile.currently_working')}</Text>
                      </View>

                      <View style={styles.aerligEntryEditRow}>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                          value={entry.from || ''}
                          placeholder={t('profile.from_placeholder')}
                          onChangeText={(value) => {
                            const items = [...experienceEntries];
                            items[index].from = value;
                            setExperienceEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0 }, entry.current && { opacity: 0.6 }]}
                          value={entry.current ? t('profile.now') : (entry.to || '')}
                          placeholder={entry.current ? t('profile.now') : t('profile.to_placeholder')}
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
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{t('profile.add_experience')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.education_title')}</Text>
                <Text style={styles.profileCardValue}>
                  {educationEntries.length > 0 ? `${educationEntries.length}` : t('profile.no_education')}
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
                        {editingEducationIndex === index ? t('common.done') : t('common.edit')}
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
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>{t('common.remove')}</Text>
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
                            {entry.school || t('profile.school_placeholder')}
                          </Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, { flex: 1, marginRight: 0 }]}
                          value={entry.degree}
                          placeholder={t('profile.degree_placeholder')}
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
                            placeholder={t('profile.school_search_placeholder')}
                            value={schoolFilter}
                            onChangeText={setSchoolFilter}
                            autoCapitalize="words"
                          />
                          <View style={[styles.filterChipRow, styles.aerligFilterChipRow]}>
                            {[
                              { key: 'all', label: t('profile.school_filter_all') },
                              { key: 'vgs', label: t('profile.school_filter_vgs') },
                              { key: 'universitet', label: t('profile.school_filter_uni') },
                              { key: 'nettskole', label: t('profile.school_filter_online') },
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
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>{t('profile.school_search_hint')}</Text>
                          ) : null}
                          {schoolResultsLoading ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>{t('profile.school_loading')}</Text>
                          ) : null}
                          {!schoolResultsLoading && schoolFilter.trim().length >= 2 && (
                            (schoolResults.length === 0 &&
                              schoolOptions.filter((s) => s.toLowerCase().includes(schoolFilter.toLowerCase())).length === 0)
                          ) ? (
                            <Text style={[styles.helpText, styles.aerligHelpText, { marginLeft: 12, marginBottom: 8 }]}>{t('profile.school_no_results')}</Text>
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
                          placeholder={t('profile.from_placeholder')}
                          onChangeText={(value) => {
                            const items = [...educationEntries];
                            items[index].from = value;
                            setEducationEntries(items);
                          }}
                        />
                        <TextInput
                          style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0 }]}
                          value={entry.to}
                          placeholder={t('profile.to_placeholder')}
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
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{t('profile.add_education')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Skills card with inline edit */}
        <View style={[styles.profileSummaryCardFull, { marginBottom: 20 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: _skillsList.length > 0 ? 8 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.profileCardIcon, { marginBottom: 0 }]}>⚡</Text>
              <Text style={[styles.profileCardLabel, { marginBottom: 0 }]}>{t('profile.skills_section')}</Text>
            </View>
            <TouchableOpacity onPress={() => setExpandSkillsCard((v) => !v)}>
              <Text style={{ fontSize: 12, color: '#E8501A', fontWeight: '500' }}>{expandSkillsCard ? t('common.done') : t('common.edit')}</Text>
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
                  placeholder={t('profile.skill_placeholder')}
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
                  <Text style={styles.aerligSecondaryButtonText}>{t('common.add')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.languages_section')}</Text>
                <Text style={styles.profileCardValue}>
                  {languagesList.length > 0 ? `${languagesList.length}` : t('profile.no_languages')}
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
                        {editingLanguageIndex === index ? t('common.done') : t('common.edit')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setLanguagesList((prev) => prev.filter((_, i) => i !== index));
                        setEditingLanguageIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>{t('common.remove')}</Text>
                    </TouchableOpacity>
                  </View>
                  {editingLanguageIndex === index && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={lang.name}
                        placeholder={t('profile.language_placeholder')}
                        autoCapitalize="words"
                        onChangeText={(v) => {
                          const items = [...languagesList];
                          items[index] = { ...items[index], name: v };
                          setLanguagesList(items);
                        }}
                      />
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {[
                          t('profile.level_beginner'),
                          t('profile.level_basic'),
                          t('profile.level_good'),
                          t('profile.level_fluent'),
                          t('profile.level_native'),
                        ].map((lvl) => (
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
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{t('profile.add_language')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.gaps_section')}</Text>
                <Text style={styles.profileCardValue}>
                  {cvGapsList.length > 0 ? `${cvGapsList.length} periode${cvGapsList.length === 1 ? '' : 'r'}` : t('profile.no_gaps')}
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
                        {editingGapIndex === index ? t('common.done') : t('common.edit')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setCvGapsList((prev) => prev.filter((_, i) => i !== index));
                        setEditingGapIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>{t('common.remove')}</Text>
                    </TouchableOpacity>
                  </View>
                  {editingGapIndex === index && (
                    <View style={styles.aerligEntryEditRow}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                        value={gap.from}
                        placeholder={t('profile.gap_from_placeholder')}
                        keyboardType="numeric"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], from: v }; setCvGapsList(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput]}
                        value={gap.to}
                        placeholder={t('profile.gap_to_placeholder')}
                        keyboardType="numeric"
                        onChangeText={(v) => { const items = [...cvGapsList]; items[index] = { ...items[index], to: v }; setCvGapsList(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact, styles.inlineInput, { marginRight: 0, flex: 2 }]}
                        value={gap.description}
                        placeholder={t('profile.gap_explanation_placeholder')}
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
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{t('common.add')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.references_section')}</Text>
                <Text style={styles.profileCardValue}>
                  {referenceEntries.length > 0 ? `${referenceEntries.length} referanse${referenceEntries.length === 1 ? '' : 'r'}` : t('profile.no_references')}
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
                        {editingReferenceIndex === index ? t('common.done') : t('common.edit')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterChip, styles.aerligFilterChip, styles.aerligRowActionChip, styles.aerligRowActionChipDanger]}
                      onPress={() => {
                        setReferenceEntries((prev) => prev.filter((_, i) => i !== index));
                        setEditingReferenceIndex((cur) => cur === index ? -1 : cur > index ? cur - 1 : cur);
                      }}
                    >
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>{t('common.remove')}</Text>
                    </TouchableOpacity>
                  </View>
                  {editingReferenceIndex === index && (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.name}
                        placeholder={t('profile.ref_name_placeholder')}
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], name: v }; setReferenceEntries(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.relation || ''}
                        placeholder={t('profile.ref_title_placeholder')}
                        onChangeText={(v) => { const items = [...referenceEntries]; items[index] = { ...items[index], relation: v }; setReferenceEntries(items); }}
                      />
                      <TextInput
                        style={[styles.input, styles.aerligInput, styles.aerligInputCompact]}
                        value={ref.contact || ''}
                        placeholder={t('profile.ref_contact_placeholder')}
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
                <Text style={[styles.smallButtonText, styles.aerligSmallButtonText]}>{t('common.add')}</Text>
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
                <Text style={styles.profileCardLabel}>{t('profile.documents_section')}</Text>
                <Text style={styles.profileCardValue}>
                  {profileDocsList.length > 0 ? `${profileDocsList.length} dokument${profileDocsList.length === 1 ? '' : 'er'}` : t('profile.no_documents')}
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
                      <Text style={[styles.filterChipText, styles.aerligFilterChipText, styles.aerligRowActionTextDanger]}>{t('common.remove')}</Text>
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
                  {docsUploading ? t('profile.uploading') : t('profile.upload_btn')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {showDocTypeModal && (
          <Modal visible transparent animationType="fade" onRequestClose={() => { setShowDocTypeModal(false); setPendingDocFile(null); }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <View style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 16 }}>{t('profile.import_cv_subtitle')}</Text>
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
                  <Text style={styles.aerligSecondaryButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        <View style={styles.profileField}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.analytics_label')}</Text>
          <Text style={[styles.helpText, styles.aerligHelpText]}>{t('profile.analytics_help')}</Text>
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
            <Text style={styles.aerligLinkText}>{t('profile.privacy_link')}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.messageText, styles.aerligMessageText]}>{consentAnalytics ? t('common.on') : t('common.off')}</Text>
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

        {/* Language selector */}
        <View style={[styles.profileField, { marginTop: 8 }]}>
          <Text style={[styles.inputLabel, styles.aerligLabel]}>{t('profile.language_selector_label')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {[
              { code: 'no', flag: '🇳🇴', label: 'Norsk' },
              { code: 'en', flag: '🇬🇧', label: 'English' },
              { code: 'vi', flag: '🇻🇳', label: 'Tiếng Việt' },
            ].map(({ code, flag, label }) => {
              const active = uiLanguage === code;
              return (
                <TouchableOpacity
                  key={code}
                  onPress={() => setAndPersistUiLanguage(code)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 10, paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor: active ? '#FEF0EB' : '#F3F4F6',
                    borderBottomWidth: active ? 2 : 0,
                    borderBottomColor: '#E8501A',
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{flag}</Text>
                  <Text style={{ fontSize: 13, fontWeight: active ? '700' : '400', color: active ? '#E8501A' : '#374151' }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => setActiveTab('documents')}>
          <Text style={styles.aerligSecondaryButtonText}>{t('profile.documents_section')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aerligSecondaryButton} onPress={() => setActiveTab('settings')}>
          <Text style={styles.aerligSecondaryButtonText}>{t('settings.title')}</Text>
        </TouchableOpacity>

        {/* Autosave status */}
        <View style={styles.autoSaveBar}>
          {autoSaveStatus === 'pending' && (
            <Text style={styles.autoSaveText}>{t('profile.autosave_pending')}</Text>
          )}
          {autoSaveStatus === 'saving' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color={THEME.colors.primary} />
              <Text style={styles.autoSaveText}>{t('common.saving')}</Text>
            </View>
          )}
          {autoSaveStatus === 'saved' && (
            <Text style={[styles.autoSaveText, { color: '#16a34a' }]}>{t('profile.autosave_saved')}</Text>
          )}
          {autoSaveStatus === 'error' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[styles.autoSaveText, { color: '#dc2626' }]}>{t('profile.autosave_error')}</Text>
              <TouchableOpacity onPress={saveProfileAuto}>
                <Text style={[styles.autoSaveText, { color: THEME.colors.primary, fontWeight: '600' }]}>{t('profile.autosave_retry')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ marginTop: 32, gap: 12 }}>
          <TouchableOpacity
            style={[styles.aerligPrimaryButton, { width: '100%' }]}
            onPress={saveProfile}
          >
            <Text style={styles.aerligPrimaryButtonText}>{savingProfile ? t('common.saving') : t('profile.save_btn')}</Text>
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
            <Text style={{ color: '#E8501A', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 }}>{t('profile.logout_btn')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ alignItems: 'center', paddingVertical: 12 }}
            onPress={deleteAccount}
          >
            <Text style={{ color: '#999999', fontSize: 13 }}>{t('profile.delete_account_btn')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
