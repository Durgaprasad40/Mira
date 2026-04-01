/*
 * LOCKED (SUPPORT & FAQ)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
import React, { useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';
import { Id } from '@/convex/_generated/dataModel';
import { uploadMediaToConvex } from '@/lib/uploadUtils';

// FAQ topics content
const FAQ_TOPICS = {
  payment: {
    title: 'Payment Issues',
    icon: 'card-outline' as const,
    tips: [
      'Check that your card details are entered correctly',
      'Ensure your card has not expired',
      'Contact your bank if payments are being declined',
      'Try a different payment method if issues persist',
    ],
  },
  subscription: {
    title: 'Subscription Help',
    icon: 'star-outline' as const,
    tips: [
      'Subscriptions renew automatically unless cancelled',
      'Cancel anytime from your account settings',
      'Refunds are processed within 5-7 business days',
      'Premium features activate immediately after purchase',
    ],
  },
  account: {
    title: 'Account Issues',
    icon: 'person-outline' as const,
    tips: [
      'Reset your password using "Forgot Password"',
      'Verify your email to access all features',
      'Update your profile from the Edit Profile screen',
      'Contact support if you cannot access your account',
    ],
  },
  safety: {
    title: 'Safety & Reporting',
    icon: 'shield-outline' as const,
    tips: [
      'Report users via the ••• menu on their profile',
      'Block users to prevent them from contacting you',
      'Reports are reviewed within 24 hours',
      'Your identity is kept confidential when reporting',
    ],
  },
  verification: {
    title: 'Verification Help',
    icon: 'checkmark-circle-outline' as const,
    tips: [
      'Use good lighting and face the camera directly',
      'Remove sunglasses, hats, or anything covering your face',
      'Verification usually takes a few minutes',
      'Contact support if verification keeps failing',
    ],
  },
};

// Support categories for the form
const SUPPORT_CATEGORIES = [
  { key: 'payment', label: 'Payment issue' },
  { key: 'subscription', label: 'Subscription issue' },
  { key: 'account', label: 'Account issue' },
  { key: 'bug', label: 'Bug report' },
  { key: 'safety', label: 'Safety concern' },
  { key: 'verification', label: 'Verification issue' },
  { key: 'other', label: 'Other' },
] as const;

type CategoryKey = (typeof SUPPORT_CATEGORIES)[number]['key'];

// Attachment limits
const MAX_PHOTOS = 5;
const MAX_VIDEO_DURATION_SECONDS = 60;

// Attachment types
interface PhotoAttachment {
  uri: string;
  type: 'photo';
}

interface VideoAttachment {
  uri: string;
  type: 'video';
  duration: number; // seconds
}

type Attachment = PhotoAttachment | VideoAttachment;

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  // FAQ expansion state
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);

  // Contact form state
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('other');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Backend mutations
  const submitTicket = useMutation(api.supportTickets.submitSupportTicket);
  const generateUploadUrl = useMutation(api.supportTickets.generateUploadUrl);

  const toggleTopic = (topicKey: string) => {
    setExpandedTopic(expandedTopic === topicKey ? null : topicKey);
  };

  // Check if we have photos or video attached
  const hasPhotos = attachments.some((a) => a.type === 'photo');
  const hasVideo = attachments.some((a) => a.type === 'video');

  // Pick photos from gallery
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
        setAttachments((prev) => [...prev, ...newPhotos].slice(0, MAX_PHOTOS));
      }
    } catch (error) {
      console.error('[SUPPORT] Photo picker error:', error);
      Toast.show('Failed to select photos');
    }
  };

  // Pick video from gallery
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

        // Validate duration
        if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          Alert.alert(
            'Video Too Long',
            `Please select a video that is ${MAX_VIDEO_DURATION_SECONDS} seconds or less. Your video is ${Math.round(durationSeconds)} seconds.`
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
      console.error('[SUPPORT] Video picker error:', error);
      Toast.show('Failed to select video');
    }
  };

  // Remove an attachment
  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all attachments
  const handleClearAttachments = () => {
    setAttachments([]);
  };

  // Upload attachments and submit ticket
  const handleSubmit = async () => {
    if (!message.trim()) {
      Toast.show('Please enter a message');
      return;
    }

    if (!userId) {
      Toast.show('Please log in to submit a request');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload attachments if any
      let uploadedAttachments: { storageId: Id<'_storage'>; type: 'photo' | 'video' }[] = [];

      if (attachments.length > 0) {
        setUploadProgress(`Uploading ${attachments.length} file(s)...`);

        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          setUploadProgress(`Uploading ${i + 1} of ${attachments.length}...`);

          const storageId = await uploadMediaToConvex(
            attachment.uri,
            generateUploadUrl,
            attachment.type
          );

          uploadedAttachments.push({
            storageId,
            type: attachment.type,
          });
        }

        setUploadProgress(null);
      }

      // Submit ticket with attachments
      await submitTicket({
        userId: userId as Id<'users'>,
        category: selectedCategory,
        message: message.trim(),
        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
      });

      Toast.show('Support request submitted successfully');
      setMessage('');
      setSelectedCategory('other');
      setAttachments([]);
    } catch (error: any) {
      console.error('[SUPPORT] Submit failed:', error);
      setUploadProgress(null);
      Toast.show(error.message || 'Failed to submit request. Please try again.');
      // Note: We do NOT clear message or attachments on failure
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCategoryLabel =
    SUPPORT_CATEGORIES.find((c) => c.key === selectedCategory)?.label || 'Other';

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support & FAQ</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Your Support Requests Link */}
          <TouchableOpacity
            style={styles.historyLink}
            onPress={() => router.push('/(main)/settings/support-history')}
            activeOpacity={0.7}
          >
            <View style={styles.historyLinkLeft}>
              <View style={styles.historyIconContainer}>
                <Ionicons name="chatbubbles" size={20} color={COLORS.white} />
              </View>
              <View>
                <Text style={styles.historyLinkTitle}>Your Support Requests</Text>
                <Text style={styles.historyLinkSubtitle}>View and reply to your tickets</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          {/* FAQ Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>

            {Object.entries(FAQ_TOPICS).map(([key, topic], index, arr) => (
              <React.Fragment key={key}>
                <TouchableOpacity
                  style={[
                    styles.topicRow,
                    index === arr.length - 1 && styles.topicRowLast,
                  ]}
                  onPress={() => toggleTopic(key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.topicRowLeft}>
                    <Ionicons name={topic.icon} size={22} color={COLORS.text} />
                    <Text style={styles.topicRowTitle}>{topic.title}</Text>
                  </View>
                  <Ionicons
                    name={expandedTopic === key ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={COLORS.textLight}
                  />
                </TouchableOpacity>
                {expandedTopic === key && (
                  <View style={styles.topicContent}>
                    {topic.tips.map((tip, tipIndex) => (
                      <View key={tipIndex} style={styles.tipItem}>
                        <Text style={styles.tipBullet}>•</Text>
                        <Text style={styles.tipText}>{tip}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </React.Fragment>
            ))}
          </View>

          {/* Contact Support Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact Support</Text>
            <Text style={styles.sectionSubtitle}>
              Can't find what you're looking for? Send us a message.
            </Text>

            {/* Category Selector */}
            <Text style={styles.fieldLabel}>Category</Text>
            <TouchableOpacity
              style={styles.categorySelector}
              onPress={() => setShowCategoryPicker(!showCategoryPicker)}
              activeOpacity={0.7}
            >
              <Text style={styles.categorySelectorText}>{selectedCategoryLabel}</Text>
              <Ionicons
                name={showCategoryPicker ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>

            {/* Category Picker Dropdown */}
            {showCategoryPicker && (
              <View style={styles.categoryDropdown}>
                {SUPPORT_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      styles.categoryOption,
                      selectedCategory === cat.key && styles.categoryOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedCategory(cat.key);
                      setShowCategoryPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.categoryOptionText,
                        selectedCategory === cat.key && styles.categoryOptionTextSelected,
                      ]}
                    >
                      {cat.label}
                    </Text>
                    {selectedCategory === cat.key && (
                      <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Message Input */}
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              style={styles.messageInput}
              placeholder="Describe your issue in detail..."
              placeholderTextColor={COLORS.textMuted}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              maxLength={2000}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{message.length}/2000</Text>

            {/* Attachments Section */}
            <Text style={styles.fieldLabel}>Attach proof (optional)</Text>
            <Text style={styles.attachmentHint}>
              Up to {MAX_PHOTOS} photos OR 1 video (max {MAX_VIDEO_DURATION_SECONDS}s)
            </Text>

            {/* Attachment Buttons */}
            <View style={styles.attachmentButtons}>
              <TouchableOpacity
                style={[
                  styles.attachmentButton,
                  hasVideo && styles.attachmentButtonDisabled,
                ]}
                onPress={handleAddPhotos}
                disabled={hasVideo || isSubmitting}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="images-outline"
                  size={20}
                  color={hasVideo ? COLORS.textMuted : COLORS.primary}
                />
                <Text
                  style={[
                    styles.attachmentButtonText,
                    hasVideo && styles.attachmentButtonTextDisabled,
                  ]}
                >
                  Add Photos
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.attachmentButton,
                  hasPhotos && styles.attachmentButtonDisabled,
                ]}
                onPress={handleAddVideo}
                disabled={hasPhotos || isSubmitting}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="videocam-outline"
                  size={20}
                  color={hasPhotos ? COLORS.textMuted : COLORS.primary}
                />
                <Text
                  style={[
                    styles.attachmentButtonText,
                    hasPhotos && styles.attachmentButtonTextDisabled,
                  ]}
                >
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
                        onPress={() => handleRemoveAttachment(index)}
                      >
                        <Ionicons name="close" size={14} color={COLORS.white} />
                      </TouchableOpacity>
                    </View>
                  ))}
              </View>
            )}

            {/* Video Preview */}
            {hasVideo && (
              <View style={styles.videoPreview}>
                <View style={styles.videoInfo}>
                  <Ionicons name="videocam" size={24} color={COLORS.primary} />
                  <View style={styles.videoDetails}>
                    <Text style={styles.videoLabel}>Video attached</Text>
                    <Text style={styles.videoDuration}>
                      Duration: {formatDuration((attachments[0] as VideoAttachment).duration)}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.removeVideoButton}
                  onPress={handleClearAttachments}
                >
                  <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            )}

            {/* Upload Progress */}
            {uploadProgress && (
              <View style={styles.uploadProgress}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.uploadProgressText}>{uploadProgress}</Text>
              </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting || !message.trim()}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color={COLORS.white} />
                  <Text style={styles.submitButtonText}>Submit Request</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  // History link
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  historyLinkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyLinkTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  historyLinkSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  // FAQ topic rows
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topicRowLast: {
    borderBottomWidth: 0,
  },
  topicRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  topicRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  topicContent: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  tipBullet: {
    fontSize: 14,
    color: COLORS.primary,
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  // Contact form
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 12,
  },
  categorySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  categorySelectorText: {
    fontSize: 15,
    color: COLORS.text,
  },
  categoryDropdown: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  categoryOptionSelected: {
    backgroundColor: COLORS.primary + '15',
  },
  categoryOptionText: {
    fontSize: 15,
    color: COLORS.text,
  },
  categoryOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  messageInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 120,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  // Attachments
  attachmentHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 12,
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
    borderRadius: 10,
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
  // Photo grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  photoPreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
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
  // Video preview
  videoPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
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
  // Upload progress
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
  // Submit button
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});
