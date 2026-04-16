/**
 * Phase-2 Report a Person Screen
 *
 * Dedicated reporting flow for Deep Connect:
 * - Shows selected user at top (if userId passed via route params)
 * - Redirects to select-person if no userId provided
 * - Select report reason
 * - Add optional description
 * - Attach photo/video evidence
 * - Submit report
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 */
import React, { useState, useEffect } from 'react';
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
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';
import { Id } from '@/convex/_generated/dataModel';
import { uploadMediaToConvex } from '@/lib/uploadUtils';

const C = INCOGNITO_COLORS;

// Report reasons
const REPORT_REASONS = [
  { key: 'harassment', label: 'Harassment', icon: 'alert-circle-outline' as const },
  { key: 'fake_profile', label: 'Fake Profile', icon: 'person-remove-outline' as const },
  { key: 'spam', label: 'Spam', icon: 'mail-unread-outline' as const },
  { key: 'inappropriate_content', label: 'Inappropriate Content', icon: 'eye-off-outline' as const },
  { key: 'safety_concern', label: 'Safety Concern', icon: 'shield-outline' as const },
  { key: 'impersonation', label: 'Impersonation', icon: 'people-outline' as const },
  { key: 'underage', label: 'Underage Concern', icon: 'warning-outline' as const },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
] as const;

type ReportReasonKey = (typeof REPORT_REASONS)[number]['key'];

// Phase-2 UI reasons -> moderation pipeline reasons (api.users.reportUser)
const REPORT_REASON_TO_MODERATION_REASON: Record<
  ReportReasonKey,
  'fake_profile' | 'inappropriate_photos' | 'harassment' | 'spam' | 'underage' | 'other'
> = {
  harassment: 'harassment',
  fake_profile: 'fake_profile',
  spam: 'spam',
  inappropriate_content: 'inappropriate_photos',
  safety_concern: 'other',
  impersonation: 'fake_profile',
  underage: 'underage',
  other: 'other',
};

// Attachment limits
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

export default function ReportPersonScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // CONTRACT FIX: Use userId instead of token
  const { userId } = useAuthStore();

  // Get route params (passed from select-person or direct context reporting)
  const params = useLocalSearchParams<{ userId?: string; userName?: string; userPhoto?: string }>();
  const reportedUserId = params.userId;
  const reportedUserName = params.userName || 'Anonymous';
  const reportedUserPhoto = params.userPhoto;

  // Redirect to selection if no userId provided
  useEffect(() => {
    if (!reportedUserId) {
      // No user selected, redirect to person selection
      router.replace('/(main)/(private)/settings/select-person' as any);
    }
  }, [reportedUserId, router]);

  // Form state
  const [selectedReason, setSelectedReason] = useState<ReportReasonKey | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Evidence state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Backend mutation - real moderation report (NOT support ticket)
  const reportUser = useMutation(api.users.reportUser);
  const generateReportEvidenceUploadUrl = useMutation(api.users.generateReportEvidenceUploadUrl);

  // If no userId, show nothing while redirecting
  if (!reportedUserId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  const hasPhotos = attachments.some((a) => a.type === 'photo');
  const hasVideo = attachments.some((a) => a.type === 'video');

  // Pick photos
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
      console.error('[REPORT] Photo picker error:', error);
      Toast.show('Failed to select photos');
    }
  };

  // Pick video
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

        // Either up to 5 photos OR 1 video
        setAttachments([newVideo]);
      }
    } catch (error) {
      console.error('[REPORT] Video picker error:', error);
      Toast.show('Failed to select video');
    }
  };

  // Submit report
  const handleSubmit = async () => {
    if (!selectedReason) {
      Toast.show('Please select a reason for your report');
      return;
    }

    // CONTRACT FIX: Check userId instead of token
    if (!userId) {
      Toast.show('Please log in to submit a report');
      return;
    }

    setIsSubmitting(true);

    try {
      const moderationReason = REPORT_REASON_TO_MODERATION_REASON[selectedReason];

      // Upload evidence (if any) to Convex storage and attach storage IDs to the report
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
              const res = await generateReportEvidenceUploadUrl({ authUserId: userId });
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

      await reportUser({
        authUserId: userId,
        reportedUserId: reportedUserId as Id<'users'>,
        reason: moderationReason,
        description: description.trim() ? description.trim() : undefined,
        evidence,
      });

      Toast.show('Report submitted successfully');
      router.back();
    } catch (error: any) {
      console.error('[REPORT] Submit failed:', error);
      setUploadProgress(null);
      Toast.show(error.message || 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedReasonLabel = REPORT_REASONS.find((r) => r.key === selectedReason)?.label;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
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
                <Ionicons name="person" size={24} color={C.textLight} />
              </View>
            )}
            <View style={styles.selectedUserInfo}>
              <Text style={styles.selectedUserLabel}>Reporting</Text>
              <Text style={styles.selectedUserName} numberOfLines={1}>
                {reportedUserName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.changeUserButton}
              onPress={() => router.replace('/(main)/(private)/settings/select-person' as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.changeUserButtonText}>Change</Text>
            </TouchableOpacity>
          </View>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Ionicons name="shield-checkmark" size={24} color={C.primary} />
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>Your Safety Matters</Text>
              <Text style={styles.infoText}>
                Reports are reviewed by our team within 24 hours. Your identity is kept confidential.
              </Text>
            </View>
          </View>

          {/* Reason Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reason for Report</Text>
            <Text style={styles.sectionSubtitle}>Select the reason that best describes the issue</Text>

            <View style={styles.reasonGrid}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.key}
                  style={[
                    styles.reasonCard,
                    selectedReason === reason.key && styles.reasonCardSelected,
                  ]}
                  onPress={() => setSelectedReason(reason.key)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.reasonIconBox,
                    selectedReason === reason.key && styles.reasonIconBoxSelected,
                  ]}>
                    <Ionicons
                      name={reason.icon}
                      size={22}
                      color={selectedReason === reason.key ? '#FFF' : C.text}
                    />
                  </View>
                  <Text style={[
                    styles.reasonLabel,
                    selectedReason === reason.key && styles.reasonLabelSelected,
                  ]}>
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Details</Text>
            <Text style={styles.sectionSubtitle}>Optional: Provide more context about the issue</Text>

            <TextInput
              style={styles.descriptionInput}
              placeholder="Describe what happened..."
              placeholderTextColor={C.textLight}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              maxLength={1000}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{description.length}/1000</Text>
          </View>

          {/* Evidence */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Evidence (Optional)</Text>
            <Text style={styles.sectionSubtitle}>
              Up to {MAX_PHOTOS} photos OR 1 video (max {MAX_VIDEO_DURATION_SECONDS}s)
            </Text>

            {/* Attachment Buttons */}
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
                  color={hasVideo ? C.textLight : C.primary}
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
                  color={hasPhotos ? C.textLight : C.primary}
                />
                <Text style={[styles.attachmentButtonText, hasPhotos && styles.attachmentButtonTextDisabled]}>
                  Add Video
                </Text>
              </TouchableOpacity>
            </View>

            {/* Photo Preview Grid */}
            {hasPhotos && (
              <View style={styles.photoGrid}>
                {attachments
                  .filter((a): a is PhotoAttachment => a.type === 'photo')
                  .map((photo, index) => (
                    <View key={index} style={styles.photoPreview}>
                      <Image
                        source={{ uri: photo.uri }}
                        style={styles.photoImage}
                        contentFit="cover"
                      />
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

            {/* Video Preview */}
            {hasVideo && (
              <View style={styles.videoPreview}>
                <View style={styles.videoInfo}>
                  <Ionicons name="videocam" size={24} color={C.primary} />
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
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}

            {/* Upload Progress */}
            {uploadProgress && (
              <View style={styles.uploadProgress}>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.uploadProgressText}>{uploadProgress}</Text>
              </View>
            )}
          </View>

          {/* Submit Button */}
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
    backgroundColor: C.background,
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
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Selected user card
  selectedUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
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
    backgroundColor: C.accent,
  },
  selectedUserAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedUserInfo: {
    flex: 1,
  },
  selectedUserLabel: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 2,
  },
  selectedUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  changeUserButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: C.accent,
    borderRadius: 8,
  },
  changeUserButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.primary,
  },
  // Info card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
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
    color: C.text,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: C.textLight,
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
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 14,
  },
  // Reason selection
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reasonCard: {
    width: '48%',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reasonCardSelected: {
    borderColor: C.primary,
    backgroundColor: C.primary + '15',
  },
  reasonIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  reasonIconBoxSelected: {
    backgroundColor: C.primary,
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  reasonLabelSelected: {
    color: C.primary,
  },
  // Description input
  descriptionInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    minHeight: 100,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  // Attachments
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
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.primary,
  },
  attachmentButtonDisabled: {
    borderColor: C.border,
    opacity: 0.5,
  },
  attachmentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },
  attachmentButtonTextDisabled: {
    color: C.textLight,
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
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
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
    color: C.text,
  },
  videoDuration: {
    fontSize: 12,
    color: C.textLight,
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
    color: C.textLight,
  },
  // Submit
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
    backgroundColor: '#EF4444',
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
