import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '../context/AppContext';

const ORANGE = '#E8501A';

export default function OnboardingSlidesScreen({ onDone }) {
  const { t } = useApp();
  const [index, setIndex] = useState(0);

  // Built inside the component (not a module-level constant) so it re-reads
  // t() reactively -- a module-level array would freeze at whatever language
  // was active when the JS bundle first loaded.
  const SLIDES = [
    {
      icon: '🎯',
      title: t('onboarding_intro.slide1_title'),
      text: t('onboarding_intro.slide1_text'),
    },
    {
      icon: '📄',
      title: t('onboarding_intro.slide2_title'),
      text: t('onboarding_intro.slide2_text'),
    },
    {
      icon: '🎤',
      title: t('onboarding_intro.slide3_title'),
      text: t('onboarding_intro.slide3_text'),
    },
    // Closing recap slide -- reinforces the actual order of operations
    // (upload CV first, it's what the analysis/generation steps need) right
    // before the user is dropped into the app, since this is the screen
    // they'll actually remember. Rendered differently from the three slides
    // above (see `type` below) instead of forcing the icon/title/text layout
    // to fit a 3-item list.
    {
      type: 'summary',
      title: t('onboarding_intro.slide4_title'),
      steps: [
        { icon: '📄', text: t('onboarding_intro.slide4_step1') },
        { icon: '🔗', text: t('onboarding_intro.slide4_step2') },
        { icon: '✨', text: t('onboarding_intro.slide4_step3') },
      ],
    },
  ];

  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  function handleNext() {
    if (isLast) {
      onDone();
    } else {
      setIndex((i) => i + 1);
    }
  }

  return (
    <View style={st.container}>
      <TouchableOpacity
        style={st.skipButton}
        onPress={onDone}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={st.skipText}>{t('onboarding_intro.skip')}</Text>
      </TouchableOpacity>

      <View style={st.content}>
        {slide.type === 'summary' ? (
          <>
            <Text style={st.summaryTitle}>{slide.title}</Text>
            {slide.steps.map((step, i) => (
              <View key={i} style={st.stepRow}>
                <View style={st.stepNumber}>
                  <Text style={st.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={st.stepIcon}>{step.icon}</Text>
                <Text style={st.stepText}>{step.text}</Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={st.icon}>{slide.icon}</Text>
            <Text style={st.title}>{slide.title}</Text>
            <Text style={st.text}>{slide.text}</Text>
          </>
        )}
      </View>

      <View style={st.dotsRow}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[st.dot, i === index && st.dotActive]} />
        ))}
      </View>

      <TouchableOpacity style={st.nextButton} onPress={handleNext} activeOpacity={0.85}>
        <Text style={st.nextButtonText}>
          {(isLast ? t('onboarding_intro.get_started') : t('onboarding_intro.next')) + ' →'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  skipButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 8,
    zIndex: 1,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 48,
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  text: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 28,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFF8F5',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  stepIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E7EB',
  },
  dotActive: {
    width: 24,
    backgroundColor: ORANGE,
  },
  nextButton: {
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
