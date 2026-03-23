/**
 * BasicInfoSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles First name, Last name, and read-only fields (Nickname, Age, Gender).
 *
 * NO LOGIC CHANGES - Structure refactor only.
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
  firstName: string;
  lastName: string;
  onChangeFirstName: (value: string) => void;
  onChangeLastName: (value: string) => void;
  currentUser: {
    handle?: string;
    nickname?: string;
    dateOfBirth?: string;
    gender?: string;
  } | null;
}

export function BasicInfoSection({
  firstName,
  lastName,
  onChangeFirstName,
  onChangeLastName,
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
      {/* Row 1: First Name + Last Name side by side */}
      <View style={styles.nameRow}>
        <View style={styles.nameField}>
          <Text style={styles.label}>First Name</Text>
          <Input
            placeholder="First"
            value={firstName}
            onChangeText={onChangeFirstName}
            maxLength={20}
            autoCapitalize="words"
          />
        </View>
        <View style={styles.nameField}>
          <Text style={styles.label}>Last Name</Text>
          <Input
            placeholder="Last"
            value={lastName}
            onChangeText={onChangeLastName}
            maxLength={20}
            autoCapitalize="words"
          />
        </View>
      </View>
      {/* Row 2: Nickname full width */}
      <View style={styles.inputRow}>
        <Text style={styles.label}>Nickname / User ID</Text>
        <View style={styles.readOnlyField}>
          <Text style={styles.readOnlyText}>@{currentUser?.handle || currentUser?.nickname || '—'}</Text>
          <Ionicons name="lock-closed" size={14} color={COLORS.textMuted} />
        </View>
      </View>
      {/* Row 3: Age + Gender compact side by side */}
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
      <Text style={styles.readOnlyHint}>Nickname, Age, and Gender cannot be changed.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  inputRow: { marginBottom: 20 },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  nameField: {
    flex: 1,
  },
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
