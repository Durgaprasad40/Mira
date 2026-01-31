import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { DesireTagPicker } from '@/components/private/DesireTagPicker';
import { BoundaryChecklist } from '@/components/private/BoundaryChecklist';
import { filterContent, getFilterMessage } from '@/lib/contentFilter';

const C = INCOGNITO_COLORS;
const BIO_MAX = 200;

export default function CategoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const desireTags = usePrivateProfileStore((s) => s.desireTags);
  const boundaries = usePrivateProfileStore((s) => s.boundaries);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const consentAgreed = usePrivateProfileStore((s) => s.consentAgreed);
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);
  const setDesireTags = usePrivateProfileStore((s) => s.setDesireTags);
  const setBoundaries = usePrivateProfileStore((s) => s.setBoundaries);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const setConsentAgreed = usePrivateProfileStore((s) => s.setConsentAgreed);
  const setCurrentStep = usePrivateProfileStore((s) => s.setCurrentStep);

  useEffect(() => {
    setCurrentStep(3);
  }, []);

  const toggleIntent = (key: string) => {
    if (intentKeys.includes(key as any)) {
      setIntentKeys(intentKeys.filter((k) => k !== key) as any);
    } else {
      setIntentKeys([...intentKeys, key] as any);
    }
  };

  const toggleDesireTag = (key: string) => {
    if (desireTags.includes(key as any)) {
      setDesireTags(desireTags.filter((k) => k !== key) as any);
    } else {
      setDesireTags([...desireTags, key] as any);
    }
  };

  const toggleBoundary = (key: string) => {
    if (boundaries.includes(key as any)) {
      setBoundaries(boundaries.filter((k) => k !== key) as any);
    } else {
      setBoundaries([...boundaries, key] as any);
    }
  };

  const handleContinue = () => {
    if (intentKeys.length === 0) {
      Alert.alert('Intent Required', 'Please select at least one intent category.');
      return;
    }
    if (desireTags.length < 3) {
      Alert.alert('Tags Required', 'Please select at least 3 desire tags.');
      return;
    }
    if (boundaries.length < 2) {
      Alert.alert('Boundaries Required', 'Please select at least 2 boundaries.');
      return;
    }
    if (!consentAgreed) {
      Alert.alert('Consent Required', 'Please agree to the consent statement.');
      return;
    }
    if (privateBio.trim().length > 0) {
      const result = filterContent(privateBio.trim());
      if (!result.isClean) {
        Alert.alert('Bio Not Allowed', getFilterMessage(result));
        return;
      }
    }
    router.push('/(main)/(private-setup)/activate' as any);
  };

  const canProceed = intentKeys.length >= 1 && desireTags.length >= 3 && boundaries.length >= 2 && consentAgreed;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Preferences</Text>
        <Text style={styles.stepLabel}>Step 3 of 4</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Intent categories */}
        <Text style={styles.sectionTitle}>What's your intent?</Text>
        <Text style={styles.sectionHint}>Select one or more</Text>
        <View style={styles.intentGrid}>
          {PRIVATE_INTENT_CATEGORIES.map((cat) => {
            const isSelected = intentKeys.includes(cat.key as any);
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.intentChip, isSelected && { borderColor: cat.color, backgroundColor: cat.color + '15' }]}
                onPress={() => toggleIntent(cat.key)}
              >
                <Ionicons name={cat.icon as any} size={16} color={isSelected ? cat.color : C.textLight} />
                <Text style={[styles.intentText, isSelected && { color: cat.color, fontWeight: '600' }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Desire tags */}
        <View style={styles.sectionSpacer} />
        <DesireTagPicker
          selected={desireTags}
          onToggle={toggleDesireTag}
          minSelection={3}
          maxSelection={10}
        />

        {/* Boundaries */}
        <View style={styles.sectionSpacer} />
        <BoundaryChecklist
          selected={boundaries}
          onToggle={toggleBoundary}
          minRequired={2}
        />

        {/* Private bio */}
        <View style={[styles.sectionSpacer, { paddingHorizontal: 16 }]}>
          <Text style={styles.sectionTitle}>Connection Vibe (optional)</Text>
          <Text style={styles.sectionHint}>Share what you're looking for — keep it respectful</Text>
          <TextInput
            style={styles.bioInput}
            value={privateBio}
            onChangeText={setPrivateBio}
            maxLength={BIO_MAX}
            multiline
            placeholder="Describe your vibe, pace, and what you're open to..."
            placeholderTextColor={C.textLight}
          />
          <Text style={styles.charCount}>{privateBio.length}/{BIO_MAX}</Text>
        </View>

        {/* Consent */}
        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => setConsentAgreed(!consentAgreed)}
        >
          <Ionicons
            name={consentAgreed ? 'checkbox' : 'square-outline'}
            size={22}
            color={consentAgreed ? C.primary : C.textLight}
          />
          <Text style={styles.consentText}>
            I understand that Private Mode is consent-first. I will respect boundaries, communicate clearly, and report any violations.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
          onPress={handleContinue}
          disabled={!canProceed}
        >
          <Text style={styles.nextBtnText}>Continue to Activate</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  content: { paddingVertical: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, paddingHorizontal: 16, marginBottom: 4 },
  sectionHint: { fontSize: 12, color: C.textLight, paddingHorizontal: 16, marginBottom: 12 },
  sectionSpacer: { marginTop: 24 },
  intentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surface,
  },
  intentText: { fontSize: 12, color: C.textLight },
  bioInput: {
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: C.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: 8,
  },
  charCount: { fontSize: 11, color: C.textLight, textAlign: 'right', marginTop: 4 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 24,
  },
  consentText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 20 },
  bottomBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  nextBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnDisabled: { backgroundColor: C.surface },
  nextBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
