import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  ScrollView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const REPORT_REASONS = [
  { id: 'spam', label: 'Spam / Scam' },
  { id: 'harassment', label: 'Harassment / Bullying' },
  { id: 'hate_speech', label: 'Hate speech' },
  { id: 'sexual_content', label: 'Sexual content' },
  { id: 'nudity', label: 'Nudity' },
  { id: 'violent_threats', label: 'Violent threats' },
  { id: 'impersonation', label: 'Impersonation / Fake profile' },
  { id: 'selling', label: 'Selling / Promotion' },
  { id: 'other', label: 'Other' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

interface ReportUserModalProps {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  roomId?: string;
  onSubmit: (data: {
    reportedUserId: string;
    reason: ReportReason;
    details?: string;
    roomId?: string;
  }) => void;
}

export default function ReportUserModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  roomId,
  onSubmit,
}: ReportUserModalProps) {
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [detailsText, setDetailsText] = useState('');

  const handleSubmit = () => {
    if (!selectedReason) return;
    onSubmit({
      reportedUserId,
      reason: selectedReason,
      details: detailsText.trim() || undefined,
      roomId,
    });
    // Reset state
    setSelectedReason(null);
    setDetailsText('');
  };

  const handleClose = () => {
    setSelectedReason(null);
    setDetailsText('');
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          onPress={handleClose}
          activeOpacity={1}
        />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>Report {reportedUserName}</Text>
          <Text style={styles.subtitle}>
            Why are you reporting this user? Your report is anonymous.
          </Text>

          <ScrollView
            style={styles.reasonsList}
            showsVerticalScrollIndicator={false}
          >
            {REPORT_REASONS.map((reason) => {
              const isSelected = selectedReason === reason.id;
              return (
                <TouchableOpacity
                  key={reason.id}
                  style={[styles.reasonRow, isSelected && styles.reasonRowSelected]}
                  onPress={() => setSelectedReason(reason.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radio, isSelected && styles.radioSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {/* Details text box — always visible but especially for 'Other' */}
            {selectedReason && (
              <View style={styles.detailsContainer}>
                <Text style={styles.detailsLabel}>
                  {selectedReason === 'other'
                    ? 'Please describe the issue'
                    : 'Additional details (optional)'}
                </Text>
                <TextInput
                  style={styles.detailsInput}
                  placeholder="Tell us more..."
                  placeholderTextColor={C.textLight}
                  value={detailsText}
                  onChangeText={setDetailsText}
                  maxLength={500}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  autoComplete="off"
                  importantForAutofill="no"
                  textContentType="none"
                />
              </View>
            )}
          </ScrollView>

          {/* Submit */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              !selectedReason && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedReason}
            activeOpacity={0.8}
          >
            <Ionicons name="flag" size={18} color="#FFFFFF" />
            <Text style={styles.submitText}>Submit Report</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    maxHeight: SCREEN_HEIGHT * 0.8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 16,
  },
  reasonsList: {
    maxHeight: SCREEN_HEIGHT * 0.45,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  reasonRowSelected: {
    backgroundColor: C.accent,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.textLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: C.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.primary,
  },
  reasonLabel: {
    fontSize: 15,
    color: C.text,
  },
  reasonLabelSelected: {
    fontWeight: '600',
  },
  detailsContainer: {
    marginTop: 12,
    marginBottom: 8,
  },
  detailsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 8,
  },
  detailsInput: {
    backgroundColor: C.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.accent,
    padding: 12,
    fontSize: 14,
    color: C.text,
    minHeight: 80,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    backgroundColor: C.accent,
    marginTop: 12,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
});
