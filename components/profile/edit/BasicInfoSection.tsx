/**
 * BasicInfoSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles Name and read-only fields (Nickname, Age, Gender).
 *
 * IDENTITY SIMPLIFICATION: Single name field replaces firstName + lastName.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { Input } from '@/components/ui';

interface BasicInfoSectionProps {
  // IDENTITY SIMPLIFICATION: Single name field
  name: string;
  onChangeName: (value: string) => void;
  currentUser: {
    dateOfBirth?: string;
    gender?: string;
  } | null;
}

export function BasicInfoSection({
  name,
  onChangeName,
  currentUser,
}: BasicInfoSectionProps) {
  // Calculate age from DOB
  const calculateAge = () => {
    if (!currentUser?.dateOfBirth) return '—';
    return Math.floor((Date.now() - new Date(currentUser.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  };

  // Format gender display
  const formatGender = () => {
    const gender = currentUser?.gender;
    if (!gender) return '—';
    if (gender === 'male') return 'M';
    if (gender === 'female') return 'F';
    if (gender === 'non_binary') return 'NB';
    return gender.charAt(0).toUpperCase();
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Basic Info</Text>
      {/* IDENTITY SIMPLIFICATION: Single Name field (full width) */}
      <View style={styles.inputRow}>
        <Text style={styles.label}>Name</Text>
        <Input
          placeholder="Your name"
          value={name}
          onChangeText={onChangeName}
          maxLength={40}
          autoCapitalize="words"
        />
      </View>
      {/* Row 2: Age + Gender compact side by side */}
      <View style={styles.compactRow}>
        <View style={styles.compactField}>
          <Text style={styles.compactLabel}>Age</Text>
          <View style={styles.compactValue}>
            <Text style={styles.compactValueText}>{calculateAge()}</Text>
            <Ionicons name="lock-closed" size={12} color={COLORS.textMuted} />
          </View>
        </View>
        <View style={styles.compactField}>
          <Text style={styles.compactLabel}>Gender</Text>
          <View style={styles.compactValue}>
            <Text style={styles.compactValueText}>{formatGender()}</Text>
            <Ionicons name="lock-closed" size={12} color={COLORS.textMuted} />
          </View>
        </View>
      </View>
      <Text style={styles.readOnlyHint}>Age and Gender cannot be changed.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  inputRow: { marginBottom: 20 },
  compactRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  compactField: {
    flex: 1,
  },
  compactLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  compactValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compactValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  readOnlyText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
  readOnlyHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
