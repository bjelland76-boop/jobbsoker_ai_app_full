import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '../context/AppContext';

const ORANGE = '#E8501A';

const SLIDES = [
  {
    icon: '🎯',
    title: 'Ærlig match-score',
    text: 'Lim inn en jobbannonse og få en ærlig vurdering av hvor godt du passer — ingen falsk oppmuntring',
  },
  {
    icon: '📄',
    title: 'Tilpasset CV på minutter',
    text: 'AI lager CV og søknadsbrev skreddersydd til nettopp den jobben du søker — på norsk eller engelsk',
  },
  {
    icon: '🎤',
    title: 'Øv på intervju',
    text: 'Tren på intervjuspørsmål tilpasset jobben — svar med tale eller tekst og få tilbakemelding fra AI',
  },
];

export default function OnboardingSlidesScreen({ onDone }) {
  const { t } = useApp();
  const [index, setIndex] = useState(0);
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
        <Text style={st.icon}>{slide.icon}</Text>
        <Text style={st.title}>{slide.title}</Text>
        <Text style={st.text}>{slide.text}</Text>
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
