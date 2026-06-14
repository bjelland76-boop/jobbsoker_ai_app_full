import React from 'react';
import { Audio } from 'expo-av';
import {
  KeyboardAvoidingView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Platform,
} from 'react-native';

import { INTERVIEW_QUESTIONS } from '../constants/content';

const TOTAL_QUESTIONS = 8;

// Message shape:
//   AI:   { role: 'assistant', question, feedback, tip, isFinal }
//   User: { role: 'user', content }

export default function InterviewScreen({
  uiLanguage,
  t,
  analysis,
  apiFetch,
  setActiveTab,
  interviewMessages,
  setInterviewMessages,
  interviewDraft,
  setInterviewDraft,
  interviewLoading,
  setInterviewLoading,
  interviewError,
  setInterviewError,
  interviewStarted,
  setInterviewStarted,
  profileTooEmpty,
  styles,
}) {
  const scrollRef = React.useRef(null);
  const recordingRef = React.useRef(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const [isFinal, setIsFinal] = React.useState(false);

  React.useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);

  // Reset local state when interview is restarted from parent
  React.useEffect(() => {
    if (!interviewStarted) {
      setIsFinal(false);
    }
  }, [interviewStarted]);

  const ripple = Platform.OS === 'android'
    ? { android_ripple: { color: 'rgba(26, 26, 46, 0.10)' } }
    : {};

  const qList = INTERVIEW_QUESTIONS[uiLanguage] || INTERVIEW_QUESTIONS.no;
  const fallbackQuestion = qList[0] || 'Fortell litt om deg selv.';

  const jobTitle = String(analysis?.job_title || analysis?.job?.title || '').trim();
  const company = String(analysis?.company || analysis?.job?.company || '').trim();
  const jobContext = String(
    analysis?.honest_assessment
    || analysis?.raw_job_text
    || analysis?.job_text
    || ''
  ).trim();

  // Derive progress from message history
  const userTurnCount = (interviewMessages || []).filter((m) => m.role === 'user').length;
  const currentQuestionNumber = Math.min(userTurnCount + 1, TOTAL_QUESTIONS);
  const progressFraction = Math.min(userTurnCount / TOTAL_QUESTIONS, 1);

  // Build history for backend (full history, not trimmed — backend needs it for final analysis)
  function buildHistory(messages) {
    return (messages || []).map((m) => ({
      role: m.role,
      content: m.role === 'assistant'
        ? [m.feedback, m.tip, m.question].filter(Boolean).join('\n\n')
        : (m.content || ''),
    }));
  }

  async function toggleRecording() {
    if (isRecording) {
      if (!recordingRef.current) {
        setIsRecording(false);
        return;
      }
      setTranscribing(true);
      try {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        setIsRecording(false);
        if (!uri) return;

        const formData = new FormData();
        formData.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' });

        const result = await apiFetch('/interview/transcribe', {
          method: 'POST',
          body: formData,
        });
        const text = (result?.text || '').trim();
        if (text) {
          setInterviewDraft((prev) => (prev ? `${prev} ${text}` : text));
        }
      } catch (e) {
        setInterviewError('Transkribering feilet. Prøv igjen eller skriv svaret.');
      } finally {
        setTranscribing(false);
      }
    } else {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          setInterviewError('Mikrofonillatelse er nødvendig for taleopptak.');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = recording;
        setIsRecording(true);
        setInterviewError('');
      } catch (e) {
        setInterviewError('Kunne ikke starte opptak. Sjekk at appen har mikrofonillatelse.');
      }
    }
  }

  async function startInterview() {
    if (interviewLoading) return;
    if (profileTooEmpty) {
      setInterviewError(
        uiLanguage === 'en'
          ? 'Add work experience or education to your profile to get a personalised interview.'
          : 'Fyll ut profilen din (erfaring eller utdanning) for å få et personlig intervju.'
      );
      return;
    }
    setInterviewLoading(true);
    setInterviewError('');
    setIsFinal(false);

    try {
      const res = await apiFetch('/interview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_title: jobTitle,
          company,
          job_context: jobContext,
          user_answer: '',
          history: [],
        }),
      });

      setInterviewMessages([{
        role: 'assistant',
        question: String(res?.question || '').trim() || fallbackQuestion,
        feedback: '',
        tip: '',
        isFinal: false,
      }]);
      setInterviewStarted(true);
    } catch (e) {
      setInterviewError('Kunne ikke kontakte coach akkurat nå. Du kan likevel øve med et standardspørsmål.');
      setInterviewMessages([{
        role: 'assistant',
        question: fallbackQuestion,
        feedback: '',
        tip: '',
        isFinal: false,
      }]);
      setInterviewStarted(true);
    } finally {
      setInterviewLoading(false);
    }
  }

  async function sendAnswer() {
    if (interviewLoading || isFinal) return;
    const draft = String(interviewDraft || '').trim();
    if (!draft) return;

    setInterviewError('');

    const last = interviewMessages?.length > 0
      ? interviewMessages[interviewMessages.length - 1]
      : null;
    const shouldAppendUser = !(last && last.role === 'user' && last.content === draft);
    const nextMessages = shouldAppendUser
      ? [...(interviewMessages || []), { role: 'user', content: draft }]
      : [...(interviewMessages || [])];

    if (shouldAppendUser) setInterviewMessages(nextMessages);
    setInterviewLoading(true);

    try {
      const res = await apiFetch('/interview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_title: jobTitle,
          company,
          job_context: jobContext,
          user_answer: draft,
          history: buildHistory(nextMessages),
        }),
      });

      const aiMessage = {
        role: 'assistant',
        question: String(res?.question || '').trim(),
        feedback: String(res?.feedback || '').trim(),
        tip: String(res?.tip || '').trim(),
        isFinal: !!res?.is_final,
      };

      if (!aiMessage.question && !aiMessage.isFinal) {
        aiMessage.question = fallbackQuestion;
      }

      const finalMessages = [...nextMessages, aiMessage];
      setInterviewMessages(finalMessages);
      setInterviewDraft('');

      if (aiMessage.isFinal) {
        setIsFinal(true);
        setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 200);
      }
    } catch (e) {
      setInterviewError('Kunne ikke kontakte coach akkurat nå. Prøv igjen om litt.');
    } finally {
      setInterviewLoading(false);
    }
  }

  function restartInterview() {
    setInterviewMessages([]);
    setInterviewDraft('');
    setInterviewError('');
    setInterviewStarted(false);
    setIsFinal(false);
  }

  const micLabel = transcribing
    ? '⏳ Transkriberer...'
    : isRecording
      ? '⏹ Stopp opptak'
      : '🎤 Snakk svar';
  const micDisabled = interviewLoading || transcribing || isFinal;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#F5F4F1' }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 260 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.aerligHomeWrap}>
          <Pressable
            android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
            style={styles.aerligBackButton}
            onPress={() => setActiveTab('home')}
          >
            <Text style={styles.aerligBackButtonText}>‹ Tilbake</Text>
          </Pressable>

          {/* Header card */}
          <View style={styles.aerligPageCard}>
            <Text style={styles.aerligPageTitle}>{t('interviewTitle')}</Text>
            <Text style={styles.aerligPageSubtitle}>
              {jobTitle && company
                ? `${jobTitle} · ${company}`
                : jobTitle || company || t('interviewSubtitle')}
            </Text>

            {/* Progress indicator */}
            {interviewStarted && !isFinal ? (
              <View style={{ marginTop: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={[styles.aerligCardSectionTitle, { fontSize: 12, marginBottom: 0 }]}>
                    Spørsmål {currentQuestionNumber} av {TOTAL_QUESTIONS}
                  </Text>
                  <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 0, marginTop: 0 }]}>
                    {Math.round(progressFraction * 100)}%
                  </Text>
                </View>
                <View style={{
                  height: 4,
                  borderRadius: 4,
                  backgroundColor: 'rgba(139, 92, 246, 0.15)',
                  overflow: 'hidden',
                }}>
                  <View style={{
                    height: 4,
                    borderRadius: 4,
                    backgroundColor: '#8b5cf6',
                    width: `${Math.round(progressFraction * 100)}%`,
                  }} />
                </View>
              </View>
            ) : null}

            {isFinal ? (
              <View style={{
                marginTop: 12,
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                borderRadius: 10,
                paddingVertical: 6,
                paddingHorizontal: 10,
              }}>
                <Text style={{ color: '#ca8a04', fontWeight: '700', fontSize: 13 }}>
                  ✓ Intervju fullført
                </Text>
              </View>
            ) : null}

            {!interviewStarted ? (
              <>
                <View style={{
                  backgroundColor: '#F7F5F0',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                  marginTop: 8,
                  gap: 12,
                }}>
                  {[
                    'Du får spørsmål én om gangen tilpasset stillingen',
                    'Svar ærlig — appen gir deg konkret tilbakemelding',
                    'Øv så mange ganger du vil før den virkelige samtalen',
                  ].map((point) => (
                    <View key={point} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <Text style={{ fontSize: 14, color: '#E8501A', fontWeight: '700', lineHeight: 20 }}>✓</Text>
                      <Text style={{ fontSize: 14, color: '#555555', lineHeight: 20, flex: 1 }}>{point}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.aerligPrimaryButton, interviewLoading ? { opacity: 0.6 } : null]}
                  onPress={startInterview}
                  disabled={interviewLoading}
                >
                  <Text style={styles.aerligPrimaryButtonText}>
                    {interviewLoading ? 'Forbereder intervju...' : 'Start intervju'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            {interviewStarted && interviewLoading ? (
              <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 10, marginBottom: 0 }]}>
                Intervjuer tenker...
              </Text>
            ) : null}

            {interviewError ? (
              <View style={{ marginTop: 10 }}>
                <Text style={[styles.helpText, styles.aerligHelpText, { marginBottom: 0, color: '#ef4444' }]}>
                  {interviewError}
                </Text>
                {profileTooEmpty ? (
                  <TouchableOpacity onPress={() => setActiveTab('profile')} style={{ marginTop: 8 }}>
                    <Text style={{ color: '#E8501A', fontSize: 14, fontWeight: '600' }}>
                      {uiLanguage === 'en' ? '→ Go to Profile' : '→ Gå til Profil'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Chat messages */}
          {(interviewMessages || []).map((m, idx) => {
            if (m.role === 'user') {
              return (
                <View
                  key={idx}
                  style={[styles.aerligChatBubble, styles.aerligChatBubbleUser]}
                >
                  <View style={styles.aerligChatMetaRow}>
                    <View style={[styles.aerligChatTag, styles.aerligChatTagUser]}>
                      <Text style={[styles.aerligChatTagText, styles.aerligChatTagTextUser]}>Du</Text>
                    </View>
                    <Text style={styles.aerligChatMetaRight}>Svar</Text>
                  </View>
                  <Text style={styles.aerligChatText}>{m.content}</Text>
                </View>
              );
            }

            // Final analysis bubble
            if (m.isFinal) {
              return (
                <View
                  key={idx}
                  style={[
                    styles.aerligChatBubble,
                    styles.aerligChatBubbleAi,
                    {
                      backgroundColor: 'rgba(234, 179, 8, 0.07)',
                      borderColor: 'rgba(202, 138, 4, 0.35)',
                      borderWidth: 1,
                    },
                  ]}
                >
                  <View style={styles.aerligChatMetaRow}>
                    <View style={[styles.aerligChatTag, styles.aerligChatTagAi, {
                      backgroundColor: 'rgba(202, 138, 4, 0.18)',
                    }]}>
                      <Text style={[styles.aerligChatTagText, styles.aerligChatTagTextAi, {
                        color: '#ca8a04',
                      }]}>
                        ★ Analyse
                      </Text>
                    </View>
                    <Text style={styles.aerligChatMetaRight}>Sluttanalyse</Text>
                  </View>

                  {m.feedback ? (
                    <Text style={[styles.aerligChatText, { lineHeight: 22 }]}>
                      {m.feedback}
                    </Text>
                  ) : null}

                  {m.tip ? (
                    <View style={{
                      marginTop: 12,
                      backgroundColor: 'rgba(139, 92, 246, 0.10)',
                      borderRadius: 8,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                    }}>
                      <Text style={{ color: '#c4b5fd', fontWeight: '700', fontSize: 12, marginBottom: 3 }}>
                        Råd til neste intervju
                      </Text>
                      <Text style={[styles.aerligChatText, { fontSize: 13 }]}>{m.tip}</Text>
                    </View>
                  ) : null}

                  {m.question ? (
                    <Text style={[styles.aerligChatText, {
                      marginTop: 12,
                      fontWeight: '700',
                      color: '#ca8a04',
                    }]}>
                      {m.question}
                    </Text>
                  ) : null}
                </View>
              );
            }

            // Normal AI bubble (supports both new {question,feedback,tip} and legacy {content} format)
            const mainText = m.question || m.content || '';
            return (
              <View
                key={idx}
                style={[styles.aerligChatBubble, styles.aerligChatBubbleAi]}
              >
                <View style={styles.aerligChatMetaRow}>
                  <View style={[styles.aerligChatTag, styles.aerligChatTagAi]}>
                    <Text style={[styles.aerligChatTagText, styles.aerligChatTagTextAi]}>AI</Text>
                  </View>
                  <Text style={styles.aerligChatMetaRight}>Intervjuer</Text>
                </View>

                {m.feedback ? (
                  <Text style={[styles.aerligChatText, { color: '#a1a1aa', fontSize: 13, marginBottom: 8 }]}>
                    {m.feedback}
                  </Text>
                ) : null}

                <Text style={[styles.aerligChatText, { fontWeight: '600' }]}>
                  {mainText}
                </Text>

                {m.tip ? (
                  <Text style={[styles.aerligChatText, { color: '#a1a1aa', fontSize: 12, marginTop: 6 }]}>
                    Tips: {m.tip}
                  </Text>
                ) : null}
              </View>
            );
          })}

          {/* Input area — hidden after final analysis */}
          {interviewStarted && !isFinal ? (
            <View style={[styles.aerligChatBubble, styles.aerligChatBubbleUser]}>
              <View style={styles.aerligChatMetaRow}>
                <View style={[styles.aerligChatTag, styles.aerligChatTagUser]}>
                  <Text style={[styles.aerligChatTagText, styles.aerligChatTagTextUser]}>Du</Text>
                </View>
                <Text style={styles.aerligChatMetaRight}>{t('yourNotes')}</Text>
              </View>

              <TextInput
                style={[styles.input, styles.aerligInput, styles.textArea, styles.aerligChatInput]}
                value={interviewDraft}
                onChangeText={setInterviewDraft}
                placeholder={t('yourNotes')}
                multiline
                editable={!interviewLoading && !transcribing}
                onFocus={() => {
                  setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 250);
                }}
              />

              <TouchableOpacity
                style={[
                  styles.aerligSecondaryButton,
                  micDisabled ? { opacity: 0.6 } : null,
                  isRecording ? { borderColor: '#ef4444', borderWidth: 2 } : null,
                ]}
                onPress={toggleRecording}
                disabled={micDisabled}
              >
                <Text style={[
                  styles.aerligSecondaryButtonText,
                  isRecording ? { color: '#ef4444' } : null,
                ]}>
                  {micLabel}
                </Text>
              </TouchableOpacity>

              <Pressable
                {...ripple}
                style={[styles.aerligPrimaryButton, interviewLoading ? { opacity: 0.6 } : null]}
                onPress={sendAnswer}
                disabled={interviewLoading}
              >
                <Text style={styles.aerligPrimaryButtonText}>Send svar</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Post-final buttons */}
          {isFinal ? (
            <TouchableOpacity
              style={styles.aerligPrimaryButton}
              onPress={restartInterview}
            >
              <Text style={styles.aerligPrimaryButtonText}>Start nytt intervju</Text>
            </TouchableOpacity>
          ) : null}

          <Pressable
            {...ripple}
            style={[styles.aerligSecondaryButton, { marginTop: 0 }]}
            onPress={() => setActiveTab('home')}
          >
            <Text style={styles.aerligSecondaryButtonText}>Tilbake</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
