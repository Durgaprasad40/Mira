/**
 * Phase-2 Support & FAQ Screen
 *
 * Deep Connect specific support and FAQ:
 * - Support ticket history (quick link)
 * - FAQ topics relevant to Deep Connect
 * - Contact support form
 *
 * Person reporting lives under Profile → Safety.
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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

// Deep Connect specific FAQ topics
const FAQ_TOPICS = {
  deepConnect: {
    title: 'Deep Connect Basics',
    icon: 'link-outline' as const,
    tips: [
      'Deep Connect shows profiles based on personality compatibility',
      'Your private profile is separate from your main profile',
      'Use photo blur to control what others see initially',
      'Connect with users who share similar interests',
    ],
  },
  privacy: {
    title: 'Privacy & Security',
    icon: 'shield-outline' as const,
    tips: [
      'Your private photos can be blurred until you choose to reveal them',
      'You control who can message you in settings',
      'Block users to prevent them from contacting you',
      'Report any suspicious behavior immediately',
    ],
  },
  chatRooms: {
    title: 'Chat Rooms',
    icon: 'people-outline' as const,
    tips: [
      'Join chat rooms to meet people with similar interests',
      'Chat rooms have moderation to keep conversations safe',
      'You can leave a room at any time',
      'Create your own rooms for topics you care about',
    ],
  },
  truthOrDare: {
    title: 'Truth or Dare',
    icon: 'game-controller-outline' as const,
    tips: [
      'Play Truth or Dare to break the ice with new connections',
      'Choose truth to answer questions or dare for challenges',
      'Skip any question or dare you\'re not comfortable with',
      'Games are private between you and your connection',
    ],
  },
  account: {
    title: 'Account & Data',
    icon: 'person-outline' as const,
    tips: [
      'Your private profile data is encrypted and secure',
      'You can delete your private data at any time',
      'Deleted data has a 30-day recovery period',
      'Your main profile remains unaffected by private profile changes',
    ],
  },
};

// Support categories - simple and clear
const SUPPORT_CATEGORIES = [
  { key: 'bug', label: 'Bug Report', description: 'App crashes, errors, or broken features' },
  { key: 'safety', label: 'Safety Concern', description: 'General safety issues (not person-specific)' },
  { key: 'other', label: 'Other', description: 'Any other questions or feedback' },
] as const;

type CategoryKey = (typeof SUPPORT_CATEGORIES)[number]['key'];

// Attachment limits
const MAX_PHOTOS = 5;

interface PhotoAttachment {
  uri: string;
  type: 'photo';
}

export default function PrivateSupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, token } = useAuthStore();

  // FAQ expansion state
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);

  // Contact form state
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('bug');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<PhotoAttachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Backend mutations - using api.support (not supportTickets)
  const createSupportRequest = useMutation(api.support.createSupportRequest);
  const generateUploadUrl = useMutation(api.support.generateUploadUrl);
  const cleanupSupportAttachment = useMutation(api.support.cleanupSupportAttachment);

  const toggleTopic = (topicKey: string) => {
    setExpandedTopic(expandedTopic === topicKey ? null : topicKey);
  };

  // Pick photos
  const handleAddPhotos = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Gallery access is needed to select photos.');
        return;
      }

      const remainingSlots = MAX_PHOTOS - attachments.length;
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

  // Remove attachment
  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit ticket
  const handleSubmit = async () => {
    if (!message.trim()) {
      Toast.show('Please enter a message');
      return;
    }

    if (!userId || !token) {
      Toast.show('Please log in to submit a request');
      return;
    }

    setIsSubmitting(true);

    // P3-1: Track every storageId we successfully uploaded so we can
    // best-effort orphan-clean on any failure path before submit succeeds.
    const uploadedAttachments: { storageId: Id<'_storage'>; type: 'photo' }[] = [];

    // P3-1: Best-effort cleanup of orphaned support uploads. The backend
    // refuses to delete anything that is already linked to a submitted
    // ticket, so this is safe to call on any failure path. We never let
    // cleanup itself crash the submit handler.
    const cleanupUploadedAttachments = async () => {
      if (uploadedAttachments.length === 0) return;
      for (const att of uploadedAttachments) {
        try {
          await cleanupSupportAttachment({
            token,
            authUserId: userId,
            storageId: att.storageId,
          });
        } catch (cleanupError) {
          console.error('[SUPPORT] cleanup failed for storageId', att.storageId, cleanupError);
        }
      }
    };

    try {
      if (attachments.length > 0) {
        setUploadProgress(`Uploading ${attachments.length} file(s)...`);

        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          setUploadProgress(`Uploading ${i + 1} of ${attachments.length}...`);

          try {
            const storageId = await uploadMediaToConvex(
              attachment.uri,
              () => generateUploadUrl({ token }),
              'photo'
            );

            uploadedAttachments.push({
              storageId,
              type: 'photo',
            });
          } catch (uploadError) {
            // P3-1: One upload failed mid-loop. Roll back any already-uploaded
            // siblings before surfacing the error to the user.
            await cleanupUploadedAttachments();
            throw uploadError;
          }
        }

        setUploadProgress(null);
      }

      // Note: Backend categories are safety-focused. Map general support to 'other_safety'.
      // Uploaded photos are persisted on the support request via the `attachments` arg.
      let submitResult: { success?: boolean; error?: string; message?: string } | undefined;
      try {
        submitResult = await createSupportRequest({
          token,
          authUserId: userId,
          category: 'other_safety',
          description: `[Deep Connect - ${selectedCategory}] ${message.trim()}`,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
        });
      } catch (submitError) {
        // P3-1: Submit threw after uploads succeeded. Orphan-clean the
        // uploaded storageIds (backend refuses to delete linked ones).
        await cleanupUploadedAttachments();
        throw submitError;
      }

      // P3-1: createSupportRequest returns { success: false, error } for soft
      // failures (e.g. unauthorized, rate_limited) instead of throwing. Clean
      // up orphaned attachments in that case too.
      if (!submitResult || submitResult.success !== true) {
        await cleanupUploadedAttachments();
        const errorMessage =
          submitResult?.message ||
          (submitResult?.error === 'rate_limited'
            ? 'Maximum 5 support requests per 24 hours'
            : 'Failed to submit request. Please try again.');
        throw new Error(errorMessage);
      }

      // Submit succeeded - DO NOT clean up; attachments are now linked to the
      // newly created supportRequest row.
      Toast.show('Support request submitted successfully');
      setMessage('');
      setSelectedCategory('other');
      setAttachments([]);
    } catch (error: any) {
      console.error('[SUPPORT] Submit failed:', error);
      setUploadProgress(null);
      Toast.show(error.message || 'Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCategoryLabel =
    SUPPORT_CATEGORIES.find((c) => c.key === selectedCategory)?.label || 'Other';

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
          <Text style={styles.headerTitle}>Support & FAQ</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Support Requests */}
          <View style={styles.quickActionsSection}>
            <Text style={styles.sectionTitle}>Support</Text>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/(main)/(private)/settings/private-support-history' as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.actionIconBox, styles.actionIconBoxPrimary]}>
                <Ionicons name="chatbubbles" size={22} color="#FFF" />
              </View>
              <View style={styles.actionTextContainer}>
                <Text style={styles.actionTitle}>Support Requests</Text>
                <Text style={styles.actionSubtitle}>View and reply to your support tickets</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.textLight} />
            </TouchableOpacity>
          </View>

          {/* FAQ Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
            <Text style={styles.sectionSubtitle}>Quick answers for Deep Connect</Text>

            {Object.entries(FAQ_TOPICS).map(([key, topic], index, arr) => (
              <React.Fragment key={key}>
                <TouchableOpacity
                  style={[
                    styles.topicRow,
                    index === arr.length - 1 && !expandedTopic && styles.topicRowLast,
                  ]}
                  onPress={() => toggleTopic(key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.topicRowLeft}>
                    <View style={styles.topicIconBox}>
                      <Ionicons name={topic.icon} size={20} color={C.text} />
                    </View>
                    <Text style={styles.topicRowTitle}>{topic.title}</Text>
                  </View>
                  <Ionicons
                    name={expandedTopic === key ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={C.textLight}
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
              Need help with Deep Connect? Send us a message.
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
                color={C.textLight}
              />
            </TouchableOpacity>

            {/* Category Picker */}
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
                    <View style={styles.categoryOptionContent}>
                      <Text
                        style={[
                          styles.categoryOptionText,
                          selectedCategory === cat.key && styles.categoryOptionTextSelected,
                        ]}
                      >
                        {cat.label}
                      </Text>
                      <Text style={styles.categoryOptionDescription}>
                        {cat.description}
                      </Text>
                    </View>
                    {selectedCategory === cat.key && (
                      <Ionicons name="checkmark" size={18} color={C.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Helper note for safety concern */}
            {selectedCategory === 'safety' && (
              <View style={styles.categoryHelperNote}>
                <Ionicons name="information-circle-outline" size={16} color={C.textLight} />
                <Text style={styles.categoryHelperText}>
                  If this is about a specific person, describe what happened and add any screenshots or details you have.
                </Text>
              </View>
            )}

            {/* Message Input */}
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              style={styles.messageInput}
              placeholder="Describe your issue in detail..."
              placeholderTextColor={C.textLight}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              maxLength={2000}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{message.length}/2000</Text>

            {/* Attachments */}
            <Text style={styles.fieldLabel}>Attach screenshots (optional)</Text>
            <Text style={styles.attachmentHint}>Up to {MAX_PHOTOS} photos</Text>

            <TouchableOpacity
              style={[styles.attachmentButton, isSubmitting && styles.attachmentButtonDisabled]}
              onPress={handleAddPhotos}
              disabled={isSubmitting || attachments.length >= MAX_PHOTOS}
              activeOpacity={0.7}
            >
              <Ionicons name="images-outline" size={20} color={C.primary} />
              <Text style={styles.attachmentButtonText}>Add Photos</Text>
            </TouchableOpacity>

            {/* Photo Preview */}
            {attachments.length > 0 && (
              <View style={styles.photoGrid}>
                {attachments.map((photo, index) => (
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
                      <Ionicons name="close" size={14} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Upload Progress */}
            {uploadProgress && (
              <View style={styles.uploadProgress}>
                <ActivityIndicator size="small" color={C.primary} />
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
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#FFF" />
                  <Text style={styles.submitButtonText}>Submit Request</Text>
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
  // Quick Actions Section
  quickActionsSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  actionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionIconBoxRed: {
    backgroundColor: '#EF4444',
  },
  actionIconBoxBlue: {
    backgroundColor: '#3B82F6',
  },
  actionIconBoxPrimary: {
    backgroundColor: C.primary,
  },
  actionTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 17,
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
  // FAQ topics
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  topicRowLast: {
    marginBottom: 0,
  },
  topicRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topicIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topicRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  topicContent: {
    backgroundColor: C.accent,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    marginTop: -4,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  tipBullet: {
    fontSize: 14,
    color: C.primary,
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
  // Contact form
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
    marginTop: 12,
  },
  categorySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  categorySelectorText: {
    fontSize: 15,
    color: C.text,
  },
  categoryDropdown: {
    backgroundColor: C.surface,
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  categoryOptionSelected: {
    backgroundColor: C.primary + '15',
  },
  categoryOptionContent: {
    flex: 1,
  },
  categoryOptionText: {
    fontSize: 15,
    color: C.text,
    marginBottom: 2,
  },
  categoryOptionTextSelected: {
    color: C.primary,
    fontWeight: '600',
  },
  categoryOptionDescription: {
    fontSize: 12,
    color: C.textLight,
  },
  categoryHelperNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  categoryHelperText: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic',
  },
  messageInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    minHeight: 120,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  // Attachments
  attachmentHint: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 12,
  },
  attachmentButton: {
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
    opacity: 0.5,
  },
  attachmentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
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
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});
