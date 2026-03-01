import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { Toast } from '@/components/ui/Toast';
import { trackEvent } from '@/lib/analytics';

type ReportReason =
  | 'inappropriate_content'
  | 'non_consensual'
  | 'screenshot_abuse'
  | 'harassment'
  | 'other';

const REPORT_REASONS: { key: ReportReason; label: string; icon: string }[] = [
  { key: 'inappropriate_content', label: 'Inappropriate content', icon: 'alert-circle-outline' },
  { key: 'non_consensual', label: 'Non-consensual sharing', icon: 'hand-left-outline' },
  { key: 'screenshot_abuse', label: 'Screenshot abuse', icon: 'camera-outline' },
  { key: 'harassment', label: 'Harassment', icon: 'warning-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

interface ReportModalProps {
  visible: boolean;
  reporterId: string;
  reportedUserId: string;
  chatId: string;
  mediaId?: string;
  onClose: () => void;
}

export function ReportModal({
  visible,
  reporterId,
  reportedUserId,
  chatId,
  mediaId,
  onClose,
}: ReportModalProps) {
  const insets = useSafeAreaInsets();
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reportMedia = useMutation(api.events.reportMedia);

  const handleSubmit = async () => {
    if (!selectedReason) return;

    if (isDemoMode) {
      useDemoStore.getState().reportUser(
        reportedUserId,
        selectedReason,
        description.trim() || undefined,
      );
      trackEvent({ name: 'report_user', reportedUserId, reason: selectedReason });
      handleClose();
      Toast.show('Reported — thanks for keeping Mira safe');
      return;
    }

    setSubmitting(true);
    try {
      await reportMedia({
        reporterId: reporterId as any,
        reportedUserId: reportedUserId as any,
        chatId: chatId as any,
        mediaId: mediaId ? (mediaId as any) : undefined,
        reason: selectedReason,
        description: description.trim() || undefined,
      });

      trackEvent({ name: 'report_user', reportedUserId, reason: selectedReason });
      handleClose();
      Toast.show('Reported — thanks for keeping Mira safe');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedReason(null);
    setDescription('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Report</Text>
          <Text style={styles.subtitle}>Why are you reporting this?</Text>

          {REPORT_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason.key}
              style={[
                styles.reasonRow,
                selectedReason === reason.key && styles.reasonRowActive,
              ]}
              onPress={() => setSelectedReason(reason.key)}
            >
              <Ionicons
                name={reason.icon as any}
                size={20}
                color={selectedReason === reason.key ? COLORS.primary : COLORS.textLight}
              />
              <Text
                style={[
                  styles.reasonText,
                  selectedReason === reason.key && styles.reasonTextActive,
                ]}
              >
                {reason.label}
              </Text>
              {selectedReason === reason.key && (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          ))}

          {selectedReason && (
            <TextInput
              style={styles.descriptionInput}
              placeholder="Additional details (optional)"
              placeholderTextColor={COLORS.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
              autoComplete="off"
              textContentType="none"
              importantForAutofill="noExcludeDescendants"
            />
          )}

          <TouchableOpacity
            style={[styles.submitButton, !selectedReason && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!selectedReason || submitting}
          >
            <Text style={styles.submitButtonText}>
              {submitting ? 'Submitting...' : 'Submit Report'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  reasonRowActive: {
    backgroundColor: COLORS.backgroundDark,
  },
  reasonText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  reasonTextActive: {
    fontWeight: '600',
    color: COLORS.primary,
  },
  descriptionInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: COLORS.error,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 15,
    color: COLORS.textLight,
  },
});
