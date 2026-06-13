import React from 'react';
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
  styles,
}) {
  const scrollRef = React.useRef(null);

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

  async function startInterview() {
    if (interviewLoading) return;

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

      const question = String(res?.question || '').trim() || fallbackQuestion;
      const feedback = String(res?.feedback || '').trim();
      const tip = String(res?.tip || '').trim();

      const parts = [
        feedback ? `Feedback: ${feedback}` : '',
        tip ? `Tips: ${tip}` : '',
        question,
      ].filter(Boolean);

      setInterviewMessages([{ role: 'assistant', content: parts.join('\n\n') }]);
      setInterviewStarted(true);
    } catch (e) {
      setInterviewError('Kunne ikke kontakte coach akkurat nå. Du kan likevel øve med et standardsprøsmål.');
      setInterviewMessages([{ role: 'assistant', content: fallbackQuestion }]);
      setInterviewStarted(true);
    } finally {
      setInterviewLoading(false);
    }
  }

  async function sendAnswer() {
    if (interviewLoading) return;

    const draft = String(interviewDraft || '').trim();
    if (!draft) return;

    setInterviewError('');

    const last = (interviewMessages && interviewMessages.length > 0)
      ? interviewMessages[interviewMessages.length - 1]
      : null;

    const shouldAppendUser = !(last && last.role === 'user' && last.content === draft);
    const nextMessages = shouldAppendUser
      ? [...(interviewMessages || []), { role: 'user', content: draft }]
      : [...(interviewMessages || [])];

    if (shouldAppendUser) setInterviewMessages(nextMessages);

    setInterviewLoading(true);

    try {
      // Keep history short to reduce tokens.
      const history = nextMessages.slice(-8).map((m) => ({ role: m.role, content: m.content }));

      const res = await apiFetch('/interview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_title: jobTitle,
          company,
          job_context: jobContext,
          user_answer: draft,
          history,
        }),
      });

      const feedback = String(res?.feedback || '').trim();
      const tip = String(res?.tip || '').trim();
      const question = String(res?.question || '').trim() || fallbackQuestion;

      const parts = [
        feedback ? `Feedback: ${feedback}` : '',
        tip ? `Tips: ${tip}` : '',
        question,
      ].filter(Boolean);

      setInterviewMessages([...nextMessages, { role: 'assistant', content: parts.join('\n\n') }]);
      setInterviewDraft('');
    } catch (e) {
      setInterviewError('Kunne ikke kontakte coach akkurat nå. Prøv igjen om litt.');
    } finally {
      setInterviewLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
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
        <Text style={styles.aerligBackButtonText}>← Tilbake</Text>
      </Pressable>

      <View style={styles.aerligPageCard}>
        <Text style={styles.aerligPageTitle}>{t('interviewTitle')}</Text>
        <Text style={styles.aerligPageSubtitle}>{t('interviewSubtitle')}</Text>

        {!interviewStarted ? (
          <TouchableOpacity
            style={[styles.aerligPrimaryButton, interviewLoading ? { opacity: 0.6 } : null]}
            onPress={startInterview}
            disabled={interviewLoading}
          >
            <Text style={styles.aerligPrimaryButtonText}>{interviewLoading ? 'Coach tenker...' : 'Start intervju'}</Text>
          </TouchableOpacity>
        ) : null}

        {interviewStarted && interviewLoading ? (
          <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 10, marginBottom: 0 }]}>Coach tenker...</Text>
        ) : null}

        {interviewError ? (
          <Text style={[styles.helpText, styles.aerligHelpText, { marginTop: 10, marginBottom: 0 }]}>{interviewError}</Text>
        ) : null}
      </View>

      {(interviewMessages || []).map((m, idx) => {
        const isAssistant = m.role === 'assistant';
        return (
          <View
            key={idx}
            style={[styles.aerligChatBubble, isAssistant ? styles.aerligChatBubbleAi : styles.aerligChatBubbleUser]}
          >
            <View style={styles.aerligChatMetaRow}>
              <View style={[styles.aerligChatTag, isAssistant ? styles.aerligChatTagAi : styles.aerligChatTagUser]}>
                <Text style={[styles.aerligChatTagText, isAssistant ? styles.aerligChatTagTextAi : styles.aerligChatTagTextUser]}>
                  {isAssistant ? 'AI' : 'Du'}
                </Text>
              </View>
              <Text style={styles.aerligChatMetaRight}>{isAssistant ? 'Coach' : 'Svar'}</Text>
            </View>
            <Text style={styles.aerligChatText}>{m.content}</Text>
          </View>
        );
      })}

      {interviewStarted ? (
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
            editable={!interviewLoading}
            onFocus={() => {
              setTimeout(() => {
                scrollRef.current?.scrollToEnd?.({ animated: true });
              }, 250);
            }}
          />

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
