import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';
import { Id } from '@/convex/_generated/dataModel';
import type { Phase1ReportCategory } from './index';
import { uploadMediaToConvex } from '@/lib/uploadUtils';

const REPORT_REASONS = [
  { key: 'harassment', label: 'Harassment', icon: 'alert-circle-outline' as const },
  { key: 'fake_profile', label: 'Fake Profile', icon: 'person-remove-outline' as const },
  { key: 'spam', label: 'Spam / Scam', icon: 'mail-unread-outline' as const },
  { key: 'inappropriate_content', label: 'Inappropriate Content', icon: 'eye-off-outline' as const },
  { key: 'impersonation', label: 'Impersonation', icon: 'people-outline' as const },
  { key: 'underage', label: 'Underage Concern', icon: 'warning-outline' as const },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
] as const;

type ReasonKey = (typeof REPORT_REASONS)[number]['key'];

// Phase-1 backend accepted reasons
type BackendReason =
  | 'fake_profile'
  | 'inappropriate_photos'
  | 'harassment'
  | 'spam'
  | 'underage'
  | 'other';

const REASON_MAP: Record<ReasonKey, BackendReason> = {
  harassment: 'harassment',
  fake_profile: 'fake_profile',
  spam: 'spam',
  inappropriate_content: 'inappropriate_photos',
  impersonation: 'other',
  underage: 'underage',
  other: 'other',
};

// Evidence limits (matches Phase-2 UX)
const MAX_PHOTOS = 5;
const MAX_VIDEO_DURATION_SECONDS = 60;

interface PhotoAttachment {
  uri: string;
  type: 'photo';
}

interface VideoAttachment {
  uri: string;
  type: 'video';
  duration: number;
}

type Attachment = PhotoAttachment | VideoAttachment;

export default function Phase1ReportFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);

  const params = useLocalSearchParams<{
    reportedConvexUserId?: string;
    userName?: string;
    userPhoto?: string;
    sourceCategory?: string;
  }>();

  const reportedUserId = params.reportedConvexUserId;
  const reportedUserName = params.userName || 'Anonymous';
  const reportedUserPhoto = params.userPhoto;
  const sourceCategory = (params.sourceCategory as Phase1ReportCategory) || 'recent_chats';

  const reportUser = useMutation(api.users.reportUser);
  const generateReportEvidenceUploadUrl = useMutation(api.users.generateReportEvidenceUploadUrl);

  const [selectedReason, setSelectedReason] = useState<ReasonKey | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const categoryLabel = useMemo(() => {
    if (sourceCategory === 'blocked_users') return 'Blocked users';
    if (sourceCategory === 'past_connections') return 'Past connections';
    return 'Recent chats';
  }, [sourceCategory]);

  // Hard guard: if route param missing, avoid infinite loading
  if (!reportedUserId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyState}>
          <Ionicons name="flag-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyStateTitle}>No person selected</Text>
          <Text style={styles.emptyStateDescription}>
            Please go back and select a person to report.
          </Text>
          <TouchableOpacity
            style={styles.emptyStateButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyStateButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (!selectedReason) {
      Toast.show('Please select a reason for your report');
      return;
    }
    if (!authUserId) {
      Toast.show('Please log in to submit a report');
      return;
    }

    const backendReason = REASON_MAP[selectedReason];
    setIsSubmitting(true);
    try {
      // Upload evidence first (optional)
      let evidence: { storageId: Id<'_storage'>; type: 'photo' | 'video' }[] | undefined;
      if (attachments.length > 0) {
        setUploadProgress(`Uploading ${attachments.length} file(s)...`);
        const uploaded: { storageId: Id<'_storage'>; type: 'photo' | 'video' }[] = [];

        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          setUploadProgress(`Uploading ${i + 1} of ${attachments.length}...`);

          const storageId = await uploadMediaToConvex(
            attachment.uri,
            async () => {
              const res = await generateReportEvidenceUploadUrl({ authUserId });
              if ((res as any)?.success !== true || !(res as any)?.uploadUrl) {
                throw new Error('Failed to start upload');
              }
              return (res as any).uploadUrl as string;
            },
            attachment.type
          );

          uploaded.push({ storageId, type: attachment.type });
        }

        setUploadProgress(null);
        evidence = uploaded;
      }

      const result = await reportUser({
        authUserId,
        reportedUserId: reportedUserId as Id<'users'>,
        reason: backendReason,
        description: description.trim().length > 0 ? description.trim() : undefined,
        evidence,
      });

      if (result?.success === false) {
        Alert.alert(
          'Error',
          result.error === 'cannot_report_self'
            ? 'You cannot report yourself'
            : 'Failed to submit report. Please try again.'
        );
        return;
      }

      Alert.alert(
        'Report Submitted',
        'Thank you for your report. Our team will review it.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (e) {
      console.error('[Phase1Report] Submit failed:', e);
      setUploadProgress(null);
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasPhotos = attachments.some((a) => a.type === 'photo');
  const hasVideo = attachments.some((a) => a.type === 'video');

  const handleAddPhotos = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Gallery access is needed to select photos.');
        return;
      }

      const remainingSlots = MAX_PHOTOS - attachments.filter((a) => a.type === 'photo').length;
      if (remainingSlots <= 0) {
        Toast.show(`Maximum ${MAX_PHOTOS} photos allowed`);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        const newPhotos: PhotoAttachment[] = result.assets.map((asset) => ({
          uri: asset.uri,
          type: 'photo' as const,
        }));
        setAttachments((prev) => [...prev.filter((a) => a.type === 'photo'), ...newPhotos].slice(0, MAX_PHOTOS));
      }
    } catch (error) {
      console.error('[Phase1Report] Photo picker error:', error);
      Toast.show('Failed to select photos');
    }
  };

  const handleAddVideo = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Gallery access is needed to select videos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const durationSeconds = (asset.duration ?? 0) / 1000;

        if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          Alert.alert(
            'Video Too Long',
            `Please select a video that is ${MAX_VIDEO_DURATION_SECONDS} seconds or less.`
          );
          return;
        }

        const newVideo: VideoAttachment = {
          uri: asset.uri,
          type: 'video',
          duration: durationSeconds,
        };

        setAttachments([newVideo]);
      }
    } catch (error) {
      console.error('[Phase1Report] Video picker error:', error);
      Toast.show('Failed to select video');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report a Person</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Selected User Card */}
          <View style={styles.selectedUserCard}>
            {reportedUserPhoto ? (
              <Image source={{ uri: reportedUserPhoto }} style={styles.selectedUserAvatar} />
            ) : (
              <View style={[styles.selectedUserAvatar, styles.selectedUserAvatarPlaceholder]}>
                <Ionicons name="person" size={24} color={COLORS.textMuted} />
              </View>
            )}
            <View style={styles.selectedUserInfo}>
              <Text style={styles.selectedUserLabel}>Reporting • {categoryLabel}</Text>
              <Text style={styles.selectedUserName} numberOfLines={1}>
                {reportedUserName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.changeUserButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
              disabled={isSubmitting}
            >
              <Text style={styles.changeUserButtonText}>Change</Text>
            </TouchableOpacity>
          </View>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Ionicons name="shield-checkmark" size={24} color={COLORS.primary} />
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>Your Safety Matters</Text>
              <Text style={styles.infoText}>
                Reports are reviewed by our team. Your identity is kept confidential.
              </Text>
            </View>
          </View>

          {/* Reason Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reason for Report</Text>
            <Text style={styles.sectionSubtitle}>
              Select the reason that best describes the issue
            </Text>

            <View style={styles.reasonGrid}>
              {REPORT_REASONS.map((reason) => {
                const isSelected = selectedReason === reason.key;
                return (
                  <TouchableOpacity
                    key={reason.key}
                    style={[styles.reasonCard, isSelected && styles.reasonCardSelected]}
                    onPress={() => setSelectedReason(reason.key)}
                    activeOpacity={0.7}
                    disabled={isSubmitting}
                  >
                    <View
                      style={[
                        styles.reasonIconBox,
                        isSelected && styles.reasonIconBoxSelected,
                      ]}
                    >
                      <Ionicons
                        name={reason.icon}
                        size={22}
                        color={isSelected ? COLORS.white : COLORS.text}
                      />
                    </View>
                    <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                      {reason.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Details</Text>
            <Text style={styles.sectionSubtitle}>
              Optional: Provide more context about the issue
            </Text>

            <TextInput
              style={styles.descriptionInput}
              placeholder="Describe what happened..."
              placeholderTextColor={COLORS.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              maxLength={1000}
              textAlignVertical="top"
              editable={!isSubmitting}
            />
            <Text style={styles.charCount}>{description.length}/1000</Text>
          </View>

          {/* Evidence */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Evidence (Optional)</Text>
            <Text style={styles.sectionSubtitle}>
              Up to {MAX_PHOTOS} photos OR 1 video (max {MAX_VIDEO_DURATION_SECONDS}s)
            </Text>

            <View style={styles.attachmentButtons}>
              <TouchableOpacity
                style={[styles.attachmentButton, hasVideo && styles.attachmentButtonDisabled]}
                onPress={handleAddPhotos}
                disabled={hasVideo || isSubmitting}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="images-outline"
                  size={20}
                  color={hasVideo ? COLORS.textMuted : COLORS.primary}
                />
                <Text style={[styles.attachmentButtonText, hasVideo && styles.attachmentButtonTextDisabled]}>
                  Add Photos
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.attachmentButton, hasPhotos && styles.attachmentButtonDisabled]}
                onPress={handleAddVideo}
                disabled={hasPhotos || isSubmitting}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="videocam-outline"
                  size={20}
                  color={hasPhotos ? COLORS.textMuted : COLORS.primary}
                />
                <Text style={[styles.attachmentButtonText, hasPhotos && styles.attachmentButtonTextDisabled]}>
                  Add Video
                </Text>
              </TouchableOpacity>
            </View>

            {hasPhotos && (
              <View style={styles.photoGrid}>
                {attachments
                  .filter((a): a is PhotoAttachment => a.type === 'photo')
                  .map((photo, index) => (
                    <View key={index} style={styles.photoPreview}>
                      <Image source={{ uri: photo.uri }} style={styles.photoImage} contentFit="cover" />
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() =>
                          setAttachments((prev) => prev.filter((_, i) => i !== index))
                        }
                        disabled={isSubmitting}
                      >
                        <Ionicons name="close" size={14} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
              </View>
            )}

            {hasVideo && (
              <View style={styles.videoPreview}>
                <View style={styles.videoInfo}>
                  <Ionicons name="videocam" size={24} color={COLORS.primary} />
                  <View style={styles.videoDetails}>
                    <Text style={styles.videoLabel}>Video attached</Text>
                    <Text style={styles.videoDuration}>
                      Duration: {Math.floor((attachments[0] as VideoAttachment).duration / 60)}:
                      {Math.round((attachments[0] as VideoAttachment).duration % 60)
                        .toString()
                        .padStart(2, '0')}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.removeVideoButton}
                  onPress={() => setAttachments([])}
                  disabled={isSubmitting}
                >
                  <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            )}

            {uploadProgress && (
              <View style={styles.uploadProgress}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.uploadProgressText}>{uploadProgress}</Text>
              </View>
            )}
          </View>

          {/* Submit */}
          <View style={styles.submitSection}>
            <TouchableOpacity
              style={[
                styles.submitButton,
                (!selectedReason || isSubmitting) && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!selectedReason || isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="flag" size={20} color="#FFF" />
                  <Text style={styles.submitButtonText}>Submit Report</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  emptyStateButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyStateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  selectedUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  selectedUserAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background,
  },
  selectedUserAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedUserInfo: {
    flex: 1,
  },
  selectedUserLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  selectedUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  changeUserButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  changeUserButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 14,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reasonCard: {
    width: '48%',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reasonCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '15',
  },
  reasonIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reasonIconBoxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  reasonLabelSelected: {
    color: COLORS.primary,
  },
  descriptionInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  attachmentButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  attachmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  attachmentButtonDisabled: {
    borderColor: COLORS.border,
    opacity: 0.5,
  },
  attachmentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  attachmentButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  photoPreview: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  videoInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  videoDetails: {
    gap: 2,
  },
  videoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  videoDuration: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  removeVideoButton: {
    padding: 8,
  },
  uploadProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  uploadProgressText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  submitSection: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.error,
    borderRadius: 14,
    paddingVertical: 16,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});

