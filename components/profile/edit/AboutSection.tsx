/**
 * AboutSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles bio text input with tap-to-focus.
 *
 * NO LOGIC CHANGES - Structure refactor only.
 */
import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
} from 'react-native';
import { COLORS } from '@/lib/constants';

interface AboutSectionProps {
  bio: string;
  onChangeBio: (value: string) => void;
}

export function AboutSection({ bio, onChangeBio }: AboutSectionProps) {
  const bioInputRef = useRef<TextInput>(null);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Bio</Text>
      <Pressable style={styles.bioContainer} onPress={() => bioInputRef.current?.focus()}>
        <TextInput
          ref={bioInputRef}
          style={styles.bioInput}
          placeholder="Write your bio..."
          placeholderTextColor={COLORS.textMuted}
          value={bio}
          onChangeText={onChangeBio}
          multiline
          numberOfLines={4}
          maxLength={500}
          textAlignVertical="top"
        />
      </Pressable>
      <Text style={styles.charCount}>{bio.length}/500</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  bioContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    minHeight: 120,
  },
  bioInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    textAlignVertical: 'top',
    padding: 0,
  },
  charCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'right', marginTop: 4 },
});
