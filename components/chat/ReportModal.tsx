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
import { useAuthStore } from '@/stores/authStore';
import type { Id } from '@/convex/_generated/dataModel';

type ReportReason =
  | 'inappropriate_content'
  | 'non_consensual'
  | 'screenshot_abuse'
  | 'harassment'
  | 'other';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const REPORT_REASONS: { key: ReportReason; label: string; icon: IoniconName }[] = [
  { key: 'inappropriate_content', label: 'Inappropriate content', icon: 'alert-circle-outline' },
  { key: 'non_consensual', label: 'Non-consensual sharing', icon: 'hand-left-outline' },
  { key: 'screenshot_abuse', label: 'Screenshot abuse', icon: 'camera-outline' },
  { key: 'harassment', label: 'Harassment', icon: 'warning-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

interface ReportModalProps {
  visible: boolean;
  // P0-1: `reporterId` is no longer trusted from the parent component — the
  // backend now derives the reporter from the validated session token.
  // The prop is retained for backward compatibility with existing callers
  // but is intentionally unused.
  reporterId: string;
  reportedUserId: string;
  chatId: string;
  mediaId?: string;
  onClose: () => void;
}

const asUserId = (value: string): Id<'users'> => value as Id<'users'>;
const asConversationId = (value: string): Id<'conversations'> => value as Id<'conversations'>;
const asMediaId = (value: string): Id<'media'> => value as Id<'media'>;
const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const REPORT_ERROR_COPY: Record<string, string> = {
  cannot_report_self: 'You cannot report yourself.',
  duplicate_recent_report: 'You already reported this user in the last 24 hours.',
  rate_limited: 'Too many reports recently. Please try again later.',
  description_too_long: 'Please shorten the additional details and try again.',
};

export function ReportModal({
  visible,
  reporterId: _reporterId,
  reportedUserId,
  chatId,
  mediaId,
  onClose,
}: ReportModalProps) {
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);
  const authUserId = useAuthStore((s) => s.userId);
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

    // P0-1: Backend now requires (token, authUserId) and derives reporterId
    // server-side. Bail out if the session is missing rather than calling the
    // mutation with invalid args.
    if (!token || !authUserId) {
      Alert.alert('Error', 'Please log in again to submit this report.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await reportMedia({
        token,
        authUserId,
        reportedUserId: asUserId(reportedUserId),
        chatId: asConversationId(chatId),
        mediaId: mediaId ? asMediaId(mediaId) : undefined,
        reason: selectedReason,
        description: description.trim() || undefined,
      });

      if (!result?.success) {
        const errorKey = result?.error ?? 'unknown';
        Alert.alert(
          'Error',
          REPORT_ERROR_COPY[errorKey] ?? 'Failed to submit report',
        );
        return;
      }

      trackEvent({ name: 'report_user', reportedUserId, reason: selectedReason });
      handleClose();
      Toast.show('Reported — thanks for keeping Mira safe');
    } catch (error: unknown) {
      Alert.alert('Error', getErrorMessage(error, 'Failed to submit report'));
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
                name={reason.icon}
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
