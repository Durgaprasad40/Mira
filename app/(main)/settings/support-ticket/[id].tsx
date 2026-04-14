import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';
import { Id } from '@/convex/_generated/dataModel';
import { uploadMediaToConvex } from '@/lib/uploadUtils';

// Category labels
const CATEGORY_LABELS: Record<string, string> = {
  payment: 'Payment',
  subscription: 'Subscription',
  account: 'Account',
  bug: 'Bug Report',
  safety: 'Safety',
  verification: 'Verification',
  other: 'Other',
};

// Status colors
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: COLORS.primary, bg: COLORS.primary + '20' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: '#F59E0B20' },
  replied: { label: 'Replied', color: '#10B981', bg: '#10B98120' },
  closed: { label: 'Closed', color: COLORS.textMuted, bg: COLORS.textMuted + '20' },
};

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
  duration: number;
}

type LocalAttachment = PhotoAttachment | VideoAttachment;

function isValidSupportTicketId(id: string | undefined): id is string {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length < 10) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

// Message item for FlatList
interface MessageItem {
  id: string;
  isOriginal: boolean;
  senderType: 'user' | 'admin';
  senderName?: string;
  message: string;
  attachments?: { storageId: Id<'_storage'>; type: 'photo' | 'video'; url: string | null }[];
  createdAt: number;
}

export default function SupportTicketScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: ticketIdParam } = useLocalSearchParams<{ id?: string | string[] }>();
  const { token } = useAuthStore();
  const flatListRef = useRef<FlatList>(null);
  const normalizedTicketId = Array.isArray(ticketIdParam) ? ticketIdParam[0] : ticketIdParam;
  const ticketId = isValidSupportTicketId(normalizedTicketId) ? normalizedTicketId.trim() : undefined;
  const shouldQueryTicket = !!ticketId && !!token;

  // Form state
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Queries
  const ticket = useQuery(
    api.supportTickets.getTicketById,
    shouldQueryTicket ? { token: token!, ticketId: ticketId as Id<'supportTickets'> } : 'skip'
  );

  const threadMessages = useQuery(
    api.supportTickets.getTicketMessages,
    shouldQueryTicket ? { token: token!, ticketId: ticketId as Id<'supportTickets'> } : 'skip'
  );
  const isTicketLoading = shouldQueryTicket && ticket === undefined;
  const isTicketUnavailable = !isTicketLoading && (!token || !ticketId || ticket === null);

  // Mutations
  const addUserMessage = useMutation(api.supportTickets.addUserMessage);
  const generateUploadUrl = useMutation(api.supportTickets.generateUploadUrl);

  const handleSafeBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace((token ? '/(main)/settings/support-history' : '/(main)/(tabs)/profile') as any);
  };

  // Build message list: original ticket message + thread messages
  const messages: MessageItem[] = React.useMemo(() => {
    if (!ticket) return [];

    const items: MessageItem[] = [];

    // Original ticket message
    items.push({
      id: 'original',
      isOriginal: true,
      senderType: 'user',
      message: ticket.message,
      attachments: ticket.attachments,
      createdAt: ticket.createdAt,
    });

    // Thread messages
    if (threadMessages) {
      for (const msg of threadMessages) {
        items.push({
          id: msg._id,
          isOriginal: false,
          senderType: msg.senderType,
          senderName: msg.senderName,
          message: msg.message,
          attachments: msg.attachments,
          createdAt: msg.createdAt,
        });
      }
    }

    return items;
  }, [ticket, threadMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const isClosed = ticket?.status === 'closed';
  const hasPhotos = attachments.some((a) => a.type === 'photo');
  const hasVideo = attachments.some((a) => a.type === 'video');

  // Format timestamp
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Photo picker
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

  // Video picker
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
      console.error('[SUPPORT] Video picker error:', error);
      Toast.show('Failed to select video');
    }
  };

  // Remove attachment
  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Send message
  const handleSend = async () => {
    if (!message.trim() && attachments.length === 0) {
      return;
    }

    if (!token || !ticketId || !ticket) {
      Toast.show('Unable to send message');
      return;
    }

    setIsSending(true);

    try {
      // Upload attachments if any
      let uploadedAttachments: { storageId: Id<'_storage'>; type: 'photo' | 'video' }[] = [];

      if (attachments.length > 0) {
        setUploadProgress(`Uploading ${attachments.length} file(s)...`);

        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          setUploadProgress(`Uploading ${i + 1} of ${attachments.length}...`);

          // CONTRACT FIX: generateUploadUrl expects no arguments
          const storageId = await uploadMediaToConvex(
            attachment.uri,
            () => generateUploadUrl(),
            attachment.type
          );

          uploadedAttachments.push({
            storageId,
            type: attachment.type,
          });
        }

        setUploadProgress(null);
      }

      // Send message
      await addUserMessage({
        token,
        ticketId: ticketId as Id<'supportTickets'>,
        message: message.trim() || '(attachment)',
        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
      });

      // Clear form
      setMessage('');
      setAttachments([]);

      // Scroll to bottom
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 200);
    } catch (error: any) {
      console.error('[SUPPORT] Send failed:', error);
      setUploadProgress(null);
      Toast.show(error.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  // Render message bubble
  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = item.senderType === 'user';

    return (
      <View style={[styles.messageContainer, isUser ? styles.messageUser : styles.messageAdmin]}>
        {/* Sender label for admin */}
        {!isUser && (
          <Text style={styles.senderLabel}>{item.senderName || 'Support Team'}</Text>
        )}

        {/* Original badge */}
        {item.isOriginal && (
          <View style={styles.originalBadge}>
            <Text style={styles.originalBadgeText}>Original Request</Text>
          </View>
        )}

        {/* Message bubble */}
        <View style={[styles.messageBubble, isUser ? styles.bubbleUser : styles.bubbleAdmin]}>
          <Text style={[styles.messageText, isUser ? styles.textUser : styles.textAdmin]}>
            {item.message}
          </Text>

          {/* Attachments: server resolves storage URLs in getTicketById / getTicketMessages */}
          {item.attachments && item.attachments.length > 0 && (
            <View style={styles.attachmentGrid}>
              {item.attachments.map((att, idx) => (
                <View key={`${att.storageId}-${idx}`} style={styles.attachmentMediaWrap}>
                  {att.type === 'photo' && att.url ? (
                    <Image
                      source={{ uri: att.url }}
                      style={styles.attachmentImage}
                      contentFit="cover"
                      accessibilityLabel="Attached photo"
                    />
                  ) : att.type === 'video' && att.url ? (
                    <View style={styles.attachmentVideoWrap}>
                      <Video
                        source={{ uri: att.url }}
                        style={styles.attachmentVideo}
                        resizeMode={ResizeMode.CONTAIN}
                        useNativeControls
                        shouldPlay={false}
                      />
                    </View>
                  ) : (
                    <View style={styles.attachmentThumb}>
                      {att.type === 'photo' ? (
                        <Ionicons name="image" size={24} color={isUser ? COLORS.white : COLORS.primary} />
                      ) : (
                        <Ionicons name="videocam" size={24} color={isUser ? COLORS.white : COLORS.primary} />
                      )}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Timestamp */}
        <Text style={styles.messageTime}>{formatTime(item.createdAt)}</Text>
      </View>
    );
  };

  // Loading state
  if (isTicketLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleSafeBack}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support Request</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (isTicketUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleSafeBack}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support Request</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.unavailableText}>
            This support request is unavailable or can’t be opened from this account.
          </Text>
          <TouchableOpacity
            style={styles.unavailableAction}
            onPress={handleSafeBack}
            accessibilityRole="button"
            accessibilityLabel={token ? 'Back to support history' : 'Back to profile'}
          >
            <Text style={styles.unavailableActionText}>
              {token ? 'Back to Support History' : 'Back to Profile'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!ticket) {
    return null;
  }

  const statusConfig = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleSafeBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {CATEGORY_LABELS[ticket.category] || ticket.category}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Ticket info bar */}
      <View style={styles.ticketInfo}>
        <Text style={styles.ticketInfoText}>
          Created {formatDate(ticket.createdAt)}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
        />

        {/* Composer or Closed banner */}
        {isClosed ? (
          <View style={[styles.closedBanner, { paddingBottom: insets.bottom + 16 }]}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.textMuted} />
            <Text style={styles.closedText}>This support request has been closed.</Text>
          </View>
        ) : (
          <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
            {/* Attachment previews */}
            {attachments.length > 0 && (
              <View style={styles.attachmentPreviewRow}>
                {attachments.map((att, idx) => (
                  <View key={idx} style={styles.attachmentPreviewItem}>
                    {att.type === 'photo' ? (
                      <Image source={{ uri: att.uri }} style={styles.previewImage} contentFit="cover" />
                    ) : (
                      <View style={styles.videoPreviewThumb}>
                        <Ionicons name="videocam" size={20} color={COLORS.white} />
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.removeAttachmentBtn}
                      onPress={() => handleRemoveAttachment(idx)}
                    >
                      <Ionicons name="close" size={12} color={COLORS.white} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Upload progress */}
            {uploadProgress && (
              <View style={styles.uploadProgressRow}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.uploadProgressText}>{uploadProgress}</Text>
              </View>
            )}

            {/* Attachment buttons */}
            <View style={styles.attachmentButtonsRow}>
              <TouchableOpacity
                style={[styles.attachmentBtn, hasVideo && styles.attachmentBtnDisabled]}
                onPress={handleAddPhotos}
                disabled={hasVideo || isSending}
              >
                <Ionicons
                  name="images-outline"
                  size={20}
                  color={hasVideo ? COLORS.textMuted : COLORS.primary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachmentBtn, hasPhotos && styles.attachmentBtnDisabled]}
                onPress={handleAddVideo}
                disabled={hasPhotos || isSending}
              >
                <Ionicons
                  name="videocam-outline"
                  size={20}
                  color={hasPhotos ? COLORS.textMuted : COLORS.primary}
                />
              </TouchableOpacity>
            </View>

            {/* Input row */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.textInput}
                placeholder="Type your message..."
                placeholderTextColor={COLORS.textMuted}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={2000}
                editable={!isSending}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!message.trim() && attachments.length === 0) && styles.sendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={isSending || (!message.trim() && attachments.length === 0)}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Ionicons name="send" size={18} color={COLORS.white} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ticketInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.backgroundDark,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  ticketInfoText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  unavailableText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  unavailableAction: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  unavailableActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  keyboardView: {
    flex: 1,
  },
  // Messages
  messagesList: {
    padding: 16,
    gap: 12,
  },
  messageContainer: {
    maxWidth: '85%',
  },
  messageUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  messageAdmin: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  senderLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 4,
  },
  originalBadge: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginBottom: 4,
  },
  originalBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '100%',
  },
  bubbleUser: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAdmin: {
    backgroundColor: COLORS.backgroundDark,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  textUser: {
    color: COLORS.white,
  },
  textAdmin: {
    color: COLORS.text,
  },
  attachmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  attachmentMediaWrap: {
    maxWidth: '100%',
  },
  attachmentImage: {
    width: 200,
    height: 160,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  attachmentVideoWrap: {
    width: 220,
    maxWidth: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  attachmentVideo: {
    width: 220,
    height: 160,
  },
  attachmentThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  // Composer
  composer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  attachmentPreviewRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  attachmentPreviewItem: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  videoPreviewThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeAttachmentBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  uploadProgressText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  attachmentButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  attachmentBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  attachmentBtnDisabled: {
    opacity: 0.4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  // Closed banner
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.backgroundDark,
  },
  closedText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
});
