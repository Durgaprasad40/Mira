/**
 * Phase-2 Support Case Thread Screen
 *
 * Displays the message thread for a support case.
 * Allows user to send text, image, video, and voice messages.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Id } from '@/convex/_generated/dataModel';
import { uploadMediaToConvex } from '@/lib/uploadUtils';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode, Audio } from 'expo-av';

const C = INCOGNITO_COLORS;

// Category labels
const CATEGORY_LABELS: Record<string, string> = {
  scam_extortion: 'Scam / Extortion',
  non_consensual_sharing: 'Non-consensual Sharing',
  physical_safety: 'Physical Safety',
  harassment_stalking: 'Harassment / Stalking',
  other_safety: 'Other Safety',
};

// Status colors
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  submitted: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  in_review: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3B82F6' },
  resolved: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
  closed: { bg: 'rgba(107, 114, 128, 0.15)', text: '#6B7280' },
};

interface MessageItem {
  messageId: string;
  senderType: 'user' | 'admin';
  text?: string;
  attachmentType?: 'image' | 'video' | 'audio';
  attachmentUrl?: string | null;
  createdAt: number;
}

// Global audio singleton to ensure only one plays at a time
let currentAudioSound: Audio.Sound | null = null;
let currentAudioId: string | null = null;

/**
 * Inline voice player for support messages
 */
function SupportVoicePlayer({ messageId, audioUrl, isUser }: { messageId: string; audioUrl: string; isUser: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        if (currentAudioId === messageId) {
          currentAudioSound = null;
          currentAudioId = null;
        }
      }
    };
  }, [messageId]);

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = async () => {
    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }

      // Stop any other playing audio
      if (currentAudioSound && currentAudioId !== messageId) {
        await currentAudioSound.stopAsync();
        await currentAudioSound.unloadAsync();
        currentAudioSound = null;
        currentAudioId = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        currentAudioSound = soundRef.current;
        currentAudioId = messageId;
      } else {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          (status) => {
            if (!isMountedRef.current) return;
            if (status.isLoaded) {
              const pos = status.positionMillis || 0;
              const dur = status.durationMillis || 0;
              setDuration(dur);
              setProgress(dur > 0 ? pos / dur : 0);
              if (status.didJustFinish) {
                setIsPlaying(false);
                setProgress(0);
                currentAudioSound = null;
                currentAudioId = null;
              }
            }
          }
        );
        soundRef.current = sound;
        currentAudioSound = sound;
        currentAudioId = messageId;
        setIsPlaying(true);
      }
    } catch (error) {
      if (__DEV__) console.error('[SupportVoicePlayer] Error:', error);
      setIsPlaying(false);
    }
  };

  return (
    <TouchableOpacity onPress={handlePlayPause} style={styles.audioPlayer} activeOpacity={0.7}>
      <View style={[styles.audioPlayBtn, { backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : C.primary + '20' }]}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={isUser ? '#FFF' : C.primary} />
      </View>
      <View style={styles.audioProgressContainer}>
        <View style={[styles.audioProgressBar, { backgroundColor: isUser ? 'rgba(255,255,255,0.3)' : C.border }]}>
          <View
            style={[
              styles.audioProgressFill,
              { width: `${progress * 100}%`, backgroundColor: isUser ? '#FFF' : C.primary },
            ]}
          />
        </View>
        <Text style={[styles.audioDuration, { color: isUser ? 'rgba(255,255,255,0.7)' : C.textLight }]}>
          {duration > 0 ? formatTime(isPlaying ? progress * duration : duration) : '0:00'}
        </Text>
      </View>
      <Ionicons name="mic" size={14} color={isUser ? 'rgba(255,255,255,0.6)' : C.textLight} />
    </TouchableOpacity>
  );
}

export default function SupportCaseThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { userId } = useAuthStore();

  const flatListRef = useRef<FlatList>(null);
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Queries
  const requestData = useQuery(
    api.support.getSupportRequestById,
    !isDemoMode && userId && requestId
      ? { authUserId: userId, requestId: requestId as Id<'supportRequests'> }
      : 'skip'
  );

  const messagesData = useQuery(
    api.support.getSupportMessages,
    !isDemoMode && userId && requestId
      ? { authUserId: userId, requestId: requestId as Id<'supportRequests'> }
      : 'skip'
  );

  // Mutations
  const sendMessage = useMutation(api.support.sendSupportMessage);
  const generateUploadUrl = useMutation(api.support.generateUploadUrl);

  // Voice recorder
  const { state: voiceState, elapsedMs, toggleRecording, isRecording } = useVoiceRecorder({
    onRecordingComplete: async (result) => {
      await handleVoiceUpload(result.audioUri);
    },
    onError: (msg) => {
      Alert.alert('Recording Error', msg);
    },
  });

  const request = requestData?.request;
  const messages = messagesData?.messages || [];
  const isLoading = requestData === undefined || messagesData === undefined;

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSendText = async () => {
    if (!messageText.trim() || !userId || !requestId || isSending) return;

    setIsSending(true);
    try {
      await sendMessage({
        authUserId: userId,
        requestId: requestId as Id<'supportRequests'>,
        text: messageText.trim(),
      });
      setMessageText('');
    } catch (error) {
      if (__DEV__) console.error('[SupportThread] Send error:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleImagePicker = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await handleMediaUpload(result.assets[0].uri, 'image');
      }
    } catch (error) {
      if (__DEV__) console.error('[SupportThread] Image picker error:', error);
      Alert.alert('Error', 'Failed to select image.');
    }
  };

  const handleVideoPicker = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets[0]) {
        await handleMediaUpload(result.assets[0].uri, 'video');
      }
    } catch (error) {
      if (__DEV__) console.error('[SupportThread] Video picker error:', error);
      Alert.alert('Error', 'Failed to select video.');
    }
  };

  const handleMediaUpload = async (uri: string, type: 'image' | 'video') => {
    if (!userId || !requestId || isUploading) return;

    setIsUploading(true);
    try {
      const storageId = await uploadMediaToConvex(
        uri,
        () => generateUploadUrl({}),
        type === 'image' ? 'photo' : 'video'
      );

      await sendMessage({
        authUserId: userId,
        requestId: requestId as Id<'supportRequests'>,
        attachmentType: type,
        attachmentStorageId: storageId,
      });
    } catch (error) {
      if (__DEV__) console.error('[SupportThread] Upload error:', error);
      Alert.alert('Error', 'Failed to upload. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleVoiceUpload = async (audioUri: string) => {
    if (!userId || !requestId) return;

    setIsUploading(true);
    try {
      const storageId = await uploadMediaToConvex(
        audioUri,
        () => generateUploadUrl({}),
        'audio'
      );

      await sendMessage({
        authUserId: userId,
        requestId: requestId as Id<'supportRequests'>,
        attachmentType: 'audio',
        attachmentStorageId: storageId,
      });
    } catch (error) {
      if (__DEV__) console.error('[SupportThread] Voice upload error:', error);
      Alert.alert('Error', 'Failed to send voice message.');
    } finally {
      setIsUploading(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderMessage = ({ item, index }: { item: MessageItem; index: number }) => {
    const isUser = item.senderType === 'user';
    const showDate =
      index === 0 ||
      new Date(messages[index - 1].createdAt).toDateString() !==
        new Date(item.createdAt).toDateString();

    return (
      <View>
        {showDate && (
          <View style={styles.dateSeparator}>
            <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
          </View>
        )}
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.adminBubble]}>
          {!isUser && (
            <View style={styles.adminHeader}>
              <Ionicons name="shield-checkmark" size={14} color={C.primary} />
              <Text style={styles.adminLabel}>Mira Safety Team</Text>
            </View>
          )}
          {item.attachmentType === 'image' && item.attachmentUrl && (
            <Image source={{ uri: item.attachmentUrl }} style={styles.attachmentImage} />
          )}
          {item.attachmentType === 'video' && item.attachmentUrl && (
            <Video
              source={{ uri: item.attachmentUrl }}
              style={styles.attachmentVideo}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
            />
          )}
          {item.attachmentType === 'audio' && item.attachmentUrl && (
            <SupportVoicePlayer messageId={item.messageId} audioUrl={item.attachmentUrl} isUser={isUser} />
          )}
          {item.text && (
            <Text style={[styles.messageText, isUser && styles.userMessageText]}>{item.text}</Text>
          )}
          <Text style={[styles.timeText, isUser && styles.userTimeText]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  if (!requestId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support Case</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorState}>
          <Text style={styles.errorText}>Case not found</Text>
        </View>
      </View>
    );
  }

  const statusStyle = STATUS_COLORS[request?.status || 'submitted'] || STATUS_COLORS.submitted;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>
              {CATEGORY_LABELS[request?.category || ''] || 'Support Case'}
            </Text>
            <View style={styles.headerMeta}>
              {request && (
                <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                  <Text style={[styles.statusText, { color: statusStyle.text }]}>
                    {request.status.replace('_', ' ')}
                  </Text>
                </View>
              )}
              {request?.relatedUser && (
                <View style={styles.headerRelatedPerson}>
                  {request.relatedUser.photoUrl ? (
                    <Image
                      source={{ uri: request.relatedUser.photoUrl }}
                      style={styles.headerRelatedAvatar}
                    />
                  ) : (
                    <View style={[styles.headerRelatedAvatar, styles.headerRelatedAvatarPlaceholder]}>
                      <Ionicons name="person" size={10} color={C.textLight} />
                    </View>
                  )}
                  <Text style={styles.headerRelatedName} numberOfLines={1}>
                    {request.relatedUser.displayName}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={{ width: 24 }} />
        </View>

        {/* Loading State */}
        {isLoading && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        )}

        {/* Messages List */}
        {!isLoading && (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.messageId}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              request ? (
                <View style={styles.caseInfo}>
                  <Text style={styles.caseInfoLabel}>Initial Report:</Text>
                  <Text style={styles.caseInfoText}>{request.description}</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <Ionicons name="chatbubbles-outline" size={40} color={C.textLight} />
                <Text style={styles.emptyText}>No messages yet. Share more details below.</Text>
              </View>
            }
          />
        )}

        {/* Composer */}
        <View style={[styles.composerContainer, { paddingBottom: insets.bottom + 8 }]}>
          {isUploading && (
            <View style={styles.uploadingBanner}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.uploadingText}>Uploading...</Text>
            </View>
          )}
          {isRecording && (
            <View style={styles.recordingBanner}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                Recording... {Math.floor(elapsedMs / 1000)}s
              </Text>
            </View>
          )}
          <View style={styles.composer}>
            {/* Attachment Buttons */}
            <TouchableOpacity
              onPress={handleImagePicker}
              style={styles.attachBtn}
              disabled={isUploading || isRecording}
            >
              <Ionicons name="image-outline" size={22} color={C.textLight} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleVideoPicker}
              style={styles.attachBtn}
              disabled={isUploading || isRecording}
            >
              <Ionicons name="videocam-outline" size={22} color={C.textLight} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleRecording}
              style={[styles.attachBtn, isRecording && styles.recordingBtn]}
              disabled={isUploading}
            >
              <Ionicons
                name={isRecording ? 'stop' : 'mic-outline'}
                size={22}
                color={isRecording ? '#EF4444' : C.textLight}
              />
            </TouchableOpacity>

            {/* Text Input */}
            <TextInput
              style={styles.textInput}
              value={messageText}
              onChangeText={setMessageText}
              placeholder="Type a message..."
              placeholderTextColor={C.textLight}
              multiline
              maxLength={2000}
              editable={!isUploading && !isRecording}
            />

            {/* Send Button */}
            <TouchableOpacity
              onPress={handleSendText}
              style={[styles.sendBtn, (!messageText.trim() || isSending) && styles.sendBtnDisabled]}
              disabled={!messageText.trim() || isSending || isUploading}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="send" size={18} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  headerRelatedPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  headerRelatedAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  headerRelatedAvatarPlaceholder: {
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRelatedName: {
    fontSize: 11,
    fontWeight: '500',
    color: C.text,
    maxWidth: 80,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 16,
    color: C.textLight,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  caseInfo: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  caseInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 6,
  },
  caseInfoText: {
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
  emptyMessages: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dateText: {
    fontSize: 12,
    color: C.textLight,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: C.primary,
    borderBottomRightRadius: 4,
  },
  adminBubble: {
    alignSelf: 'flex-start',
    backgroundColor: C.surface,
    borderBottomLeftRadius: 4,
  },
  adminHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  adminLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.primary,
  },
  messageText: {
    fontSize: 15,
    color: C.text,
    lineHeight: 21,
  },
  userMessageText: {
    color: '#FFF',
  },
  timeText: {
    fontSize: 10,
    color: C.textLight,
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  userTimeText: {
    color: 'rgba(255,255,255,0.7)',
  },
  attachmentImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginBottom: 8,
  },
  attachmentVideo: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#000',
  },
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  audioPlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioProgressContainer: {
    flex: 1,
    gap: 3,
  },
  audioProgressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  audioProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  audioDuration: {
    fontSize: 11,
    fontWeight: '500',
  },
  composerContainer: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  uploadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: C.surface,
  },
  uploadingText: {
    fontSize: 13,
    color: C.textLight,
  },
  recordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  recordingText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '500',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 6,
  },
  attachBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  recordingBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  textInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: C.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
    borderRadius: 18,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});
