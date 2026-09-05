import React from 'react';
import { Audio } from 'expo-av';
import {
  ActivityIndicator,
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
import { useApp, API } from '../context/AppContext';

const TOTAL_QUESTIONS = 8;

// Message shape:
//   AI:   { role: 'assistant', question, feedback, tip, isFinal }
//   User: { role: 'user', content }

export default function InterviewScreen({
  uiLanguage,
  t,
  jobTitle,
  company,
  jobContext,
  apiFetch,
  logEvent,
  setActiveTab,
  onBackToList,
  onEndInterview,
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
  const { showPaymentModal, authTokenState } = useApp();
  const scrollRef = React.useRef(null);
  const recordingRef = React.useRef(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);

  // TTS playback (Azure /interview/speak). Only one question's audio can be
  // active at a time -- ttsPlayingIndex identifies which message index owns
  // the currently loading/playing sound, ttsStatus its phase. ttsRequestIdRef
  // guards against a stale fetch/sound-load resolving after the user has
  // already moved on to a different question (or paused).
  const ttsSoundRef = React.useRef(null);
  const ttsObjectUrlRef = React.useRef(null);
  const ttsRequestIdRef = React.useRef(0);
  const [ttsPlayingIndex, setTtsPlayingIndex] = React.useState(null);
  const [ttsStatus, setTtsStatus] = React.useState(null); // 'loading' | 'playing' | null
  const [ttsErrorIndex, setTtsErrorIndex] = React.useState(null);

  React.useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      if (ttsSoundRef.current) {
        ttsSoundRef.current.unloadAsync().catch(() => {});
        ttsSoundRef.current = null;
      }
      if (ttsObjectUrlRef.current) {
        try { URL.revokeObjectURL(ttsObjectUrlRef.current); } catch (e) { /* ignore */ }
        ttsObjectUrlRef.current = null;
      }
    };
  }, []);

  async function stopTts() {
    ttsRequestIdRef.current += 1; // invalidate any in-flight fetch/load
    const sound = ttsSoundRef.current;
    ttsSoundRef.current = null;
    if (sound) {
      try {
        await sound.stopAsync();
      } catch (e) { /* ignore */ }
      try {
        await sound.unloadAsync();
      } catch (e) { /* ignore */ }
    }
    if (ttsObjectUrlRef.current) {
      try { URL.revokeObjectURL(ttsObjectUrlRef.current); } catch (e) { /* ignore */ }
      ttsObjectUrlRef.current = null;
    }
    setTtsPlayingIndex(null);
    setTtsStatus(null);
  }

  async function handleToggleSpeak(idx, questionText) {
    // Tapping the button for the question that's already active pauses it.
    if (ttsPlayingIndex === idx && ttsStatus) {
      await stopTts();
      return;
    }

    // Switching questions (or retrying after an error) -- stop/clear first.
    await stopTts();
    setTtsErrorIndex(null);

    const cleanText = String(questionText || '').trim();
    if (!cleanText || isRecording || transcribing) return;

    const requestId = ++ttsRequestIdRef.current;
    setTtsPlayingIndex(idx);
    setTtsStatus('loading');

    try {
      const res = await fetch(`${API}/interview/speak`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authTokenState ? { Authorization: `Bearer ${authTokenState}` } : {}),
        },
        body: JSON.stringify({ text: cleanText }),
      });

      if (!res.ok) throw new Error('tts_http_error');

      const blob = await res.blob();
      if (requestId !== ttsRequestIdRef.current) return; // superseded

      const objectUrl = URL.createObjectURL(blob);
      ttsObjectUrlRef.current = objectUrl;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: objectUrl },
        { shouldPlay: true },
        (playbackStatus) => {
          if (playbackStatus?.didJustFinish) stopTts();
        }
      );

      if (requestId !== ttsRequestIdRef.current) {
        sound.unloadAsync().catch(() => {});
        URL.revokeObjectURL(objectUrl);
        return;
      }

      ttsSoundRef.current = sound;
      setTtsStatus('playing');
    } catch (e) {
      if (requestId === ttsRequestIdRef.current) {
        setTtsPlayingIndex(null);
        setTtsStatus(null);
        setTtsErrorIndex(idx);
      }
    }
  }

  // Derived from message history (not local state) so resuming a session
  // saved in the job picker shows the right state immediately on mount.
  const lastMessage = (interviewMessages && interviewMessages.length > 0)
    ? interviewMessages[interviewMessages.length - 1]
    : null;
  const isFinal = !!(lastMessage && lastMessage.role === 'assistant' && lastMessage.isFinal);

  const ripple = Platform.OS === 'android'
    ? { android_ripple: { color: 'rgba(26, 26, 46, 0.10)' } }
    : {};

  const qList = INTERVIEW_QUESTIONS[uiLanguage] || INTERVIEW_QUESTIONS.no;
  const fallbackQuestion = qList[0] || 'Fortell litt om deg selv.';

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
        const audioResponse = await fetch(uri);
        const blob = await audioResponse.blob();
        formData.append('audio', blob, 'recording.webm');
        formData.append('language', uiLanguage);

        const result = await apiFetch('/interview/transcribe', {
          method: 'POST',
          body: formData,
        });
        const text = (result?.text || '').trim();
        if (text) {
          setInterviewDraft((prev) => (prev ? `${prev} ${text}` : text));
        }
      } catch (e) {
        setInterviewError(t('interview.transcription_failed'));
      } finally {
        setTranscribing(false);
      }
    } else {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          setInterviewError(t('interview.mic_permission'));
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = recording;
        setIsRecording(true);
        setInterviewError('');
        logEvent?.('interview_voice_used');
      } catch (e) {
        setInterviewError(t('interview.recording_failed'));
      }
    }
  }

  async function startInterview() {
    if (interviewLoading) return;
    if (profileTooEmpty) {
      setInterviewError(t('interview.profile_too_empty'));
      return;
    }
    setInterviewLoading(true);
    setInterviewError('');

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
      logEvent?.('interview_started');
    } catch (e) {
      if (e?.code === 'free_limit_reached') {
        showPaymentModal(e?.data?.limit_type || 'intervju');
        return;
      }
      setInterviewError(t('interview.start_error'));
      setInterviewMessages([{
        role: 'assistant',
        question: fallbackQuestion,
        feedback: '',
        tip: '',
        isFinal: false,
      }]);
      setInterviewStarted(true);
      logEvent?.('interview_started');
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
        logEvent?.('interview_completed');
        setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 200);
      }
    } catch (e) {
      setInterviewError(t('interview.coach_error'));
    } finally {
      setInterviewLoading(false);
    }
  }

  function restartInterview() {
    setInterviewMessages([]);
    setInterviewDraft('');
    setInterviewError('');
    setInterviewStarted(false);
  }

  const micLabel = transcribing
    ? t('interview.transcribing')
    : isRecording
      ? t('interview.recording')
      : t('interview.speak_answer');
  const micDisabled = interviewLoading || transcribing || isFinal || ttsStatus !== null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: '#F5F4F1' }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 260 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.aerligHomeWrap}>
          <Pressable
            android_ripple={{ color: 'rgba(26, 26, 46, 0.10)' }}
            style={styles.aerligBackButton}
            onPress={onBackToList}
          >
            <Text style={styles.aerligBackButtonText}>{t('common.back')}</Text>
          </Pressable>

          {/* Header card */}
          <View style={styles.aerligPageCard}>
            <Text style={styles.aerligPageTitle}>{t('interview.title')}</Text>
            <Text style={styles.aerligPageSubtitle}>
              {jobTitle && company
                ? `${jobTitle} · ${company}`
                : jobTitle || company || t('interview.subtitle')}
            </Text>

            {/* Progress indicator */}
            {interviewStarted && !isFinal ? (
              <View style={{ marginTop: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={[styles.aerligCardSectionTitle, { fontSize: 12, marginBottom: 0 }]}>
                    {t('interview.question_of', { current: currentQuestionNumber, total: TOTAL_QUESTIONS })}
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
                  {t('interview.completed')}
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
                    t('interview.point_1'),
                    t('interview.point_2'),
                    t('interview.point_3'),
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
                    {interviewLoading ? t('interview.preparing') : t('interview.start')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            {interviewStarted && interviewLoading ? (
              <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 10, marginBottom: 0 }]}>
                {t('interview.thinking')}
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
                      {t('interview.go_to_profile')}
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
            const ttsIsLoading = ttsPlayingIndex === idx && ttsStatus === 'loading';
            const ttsIsPlaying = ttsPlayingIndex === idx && ttsStatus === 'playing';
            const ttsDisabled = isRecording || transcribing;
            return (
              <View
                key={idx}
                style={[styles.aerligChatBubble, styles.aerligChatBubbleAi]}
              >
                <View style={styles.aerligChatMetaRow}>
                  <View style={[styles.aerligChatTag, styles.aerligChatTagAi]}>
                    <Text style={[styles.aerligChatTagText, styles.aerligChatTagTextAi]}>AI</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {mainText ? (
                      <TouchableOpacity
                        onPress={() => handleToggleSpeak(idx, mainText)}
                        disabled={ttsDisabled}
                        accessibilityLabel={ttsIsPlaying ? t('interview.tts_pause') : t('interview.tts_play')}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'rgba(232, 80, 26, 0.10)',
                          opacity: ttsDisabled ? 0.35 : 1,
                        }}
                      >
                        {ttsIsLoading ? (
                          <ActivityIndicator size="small" color="#E8501A" />
                        ) : (
                          <Text style={{ color: '#E8501A', fontSize: 12 }}>
                            {ttsIsPlaying ? '⏸' : '▶'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    <Text style={styles.aerligChatMetaRight}>Intervjuer</Text>
                  </View>
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

                {ttsErrorIndex === idx ? (
                  <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>
                    {t('interview.tts_failed')}
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
                <Text style={styles.aerligChatMetaRight}>{t('interview.your_notes')}</Text>
              </View>

              <TextInput
                style={[styles.input, styles.aerligInput, styles.textArea, styles.aerligChatInput]}
                value={interviewDraft}
                onChangeText={setInterviewDraft}
                placeholder={t('interview.your_notes')}
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
                <Text style={styles.aerligPrimaryButtonText}>{t('interview.send_answer')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Post-final buttons */}
          {isFinal ? (
            <TouchableOpacity
              style={styles.aerligPrimaryButton}
              onPress={restartInterview}
            >
              <Text style={styles.aerligPrimaryButtonText}>{t('interview.restart')}</Text>
            </TouchableOpacity>
          ) : null}

          {interviewStarted ? (
            <TouchableOpacity
              style={[styles.aerligSecondaryButton, { borderColor: '#ef4444' }]}
              onPress={onEndInterview}
            >
              <Text style={[styles.aerligSecondaryButtonText, { color: '#ef4444' }]}>
                {t('interview.end_interview')}
              </Text>
            </TouchableOpacity>
          ) : null}

          <Pressable
            {...ripple}
            style={[styles.aerligSecondaryButton, { marginTop: 0 }]}
            onPress={onBackToList}
          >
            <Text style={styles.aerligSecondaryButtonText}>{t('interview.back_to_jobs')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
