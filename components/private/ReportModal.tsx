/**
 * Phase 2 Report/Block/Leave Modal
 * PHASE 1 PARITY: Full backend integration for moderation actions
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { Toast } from '@/components/ui/Toast';
import { trackEvent } from '@/lib/analytics';

// Report reasons matching backend schema
const REPORT_REASONS = [
  { id: 'inappropriate_photos', label: 'Inappropriate content', icon: 'warning-outline' as const },
  { id: 'harassment', label: 'Harassment or bullying', icon: 'hand-left-outline' as const },
  { id: 'spam', label: 'Spam or scam', icon: 'megaphone-outline' as const },
  { id: 'fake_profile', label: 'Fake profile', icon: 'person-remove-outline' as const },
  { id: 'underage', label: 'Underage user', icon: 'alert-circle-outline' as const },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal' as const },
] as const;

type ReportReason = typeof REPORT_REASONS[number]['id'];
type ViewState = 'main' | 'report' | 'other';

interface ReportModalProps {
  visible: boolean;
  targetName: string;
  // Required for backend integration; optional for demo/public rooms
  targetUserId?: string;
  currentUserId?: string;
  conversationId?: string;
  onClose: () => void;
  onBlockSuccess?: () => void;
  onLeaveSuccess?: () => void;
  // Legacy callbacks for backward compatibility (used when targetUserId/currentUserId not provided)
  onReport?: (reason: string) => void;
  onBlock?: () => void;
}

export function ReportModal({
  visible,
  targetName,
  targetUserId,
  currentUserId,
  conversationId,
  onClose,
  onBlockSuccess,
  onLeaveSuccess,
  // Legacy callbacks
  onReport,
  onBlock,
}: ReportModalProps) {
  // Determine if we have full backend integration or using legacy mode
  const hasBackendIntegration = !!(targetUserId && currentUserId);
  const [viewState, setViewState] = useState<ViewState>('main');
  const [otherReason, setOtherReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Backend mutations (same as Phase 1)
  const blockMutation = useMutation(api.users.blockUser);
  const reportMutation = useMutation(api.users.reportUser);
  // Leave conversation mutation (backend-backed, not local-only)
  const leaveMutation = useMutation(api.privateConversations.leavePrivateConversation);

  // Track action with analytics
  type ChatActionType = 'unmatch' | 'uncrush' | 'block' | 'report' | 'spam' | 'scam' | 'inappropriate' | 'other';
  const logAction = (action: string, reason?: string) => {
    // Only track recognized actions
    const validActions: ChatActionType[] = ['unmatch', 'uncrush', 'block', 'report', 'spam', 'scam', 'inappropriate', 'other'];
    if (validActions.includes(action as ChatActionType) && targetUserId) {
      trackEvent({
        name: 'chat_action',
        action: action as ChatActionType,
        userId: targetUserId,
        conversationId,
        timestamp: Date.now(),
        ...(reason ? { reason } : {}),
      });
    }
    if (__DEV__) {
      console.log(`[Phase2ChatAction] ${action}`, {
        userId: targetUserId?.slice(-8),
        conversationId: conversationId?.slice(-8),
      });
    }
  };

  const resetAndClose = () => {
    Keyboard.dismiss();
    setViewState('main');
    setOtherReason('');
    setIsLoading(false);
    onClose();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOCK: Persist to backend (Phase 1 parity) or use legacy callback
  // ═══════════════════════════════════════════════════════════════════════════
  const handleBlock = () => {
    Alert.alert(
      'Block User',
      `Block ${targetName}? They won't be able to contact you and this conversation will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            // Legacy mode: use callback if no backend integration
            if (!hasBackendIntegration) {
              onBlock?.();
              resetAndClose();
              return;
            }

            logAction('block');
            setIsLoading(true);

            try {
              await blockMutation({
                authUserId: currentUserId!,
                blockedUserId: targetUserId as any,
              });

              // Update local block store for immediate UI feedback
              const { useBlockStore } = await import('@/stores/blockStore');
              useBlockStore.getState().blockUser(targetUserId!);

              Toast.show(`${targetName} blocked`);
              resetAndClose();
              onBlockSuccess?.();
            } catch (error: any) {
              setIsLoading(false);
              Alert.alert('Error', error.message || 'Failed to block user.');
            }
          },
        },
      ]
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LEAVE CONVERSATION: Backend-backed hide (Phase 2 equivalent of unmatch)
  // Persists to backend so conversation won't reappear after refresh
  // ═══════════════════════════════════════════════════════════════════════════
  const handleLeave = () => {
    Alert.alert(
      'Leave Conversation',
      `Leave this conversation with ${targetName}? You can reconnect later through Deep Connect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            logAction('leave');
            setIsLoading(true);

            try {
              // Get auth token for backend mutation
              const { useAuthStore } = await import('@/stores/authStore');
              const token = useAuthStore.getState().token;

              if (!token || !conversationId) {
                throw new Error('Missing authentication or conversation ID');
              }

              // Call backend mutation to persist the leave action
              const result = await leaveMutation({
                token,
                conversationId: conversationId as any,
              });

              if (!result.success) {
                throw new Error(result.error || 'Failed to leave conversation');
              }

              // Also remove from local store for immediate UI feedback
              const { usePrivateChatStore } = await import('@/stores/privateChatStore');
              usePrivateChatStore.getState().removeConversation(conversationId);

              Toast.show('Conversation removed');
              resetAndClose();
              onLeaveSuccess?.();
            } catch (error: any) {
              setIsLoading(false);
              Alert.alert('Error', error.message || 'Failed to leave conversation.');
            }
          },
        },
      ]
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT: Persist to backend with reason (Phase 1 parity) or use legacy callback
  // ═══════════════════════════════════════════════════════════════════════════
  const handleReportReason = async (reasonId: ReportReason) => {
    if (reasonId === 'other') {
      setViewState('other');
      return;
    }

    // Legacy mode: use callback if no backend integration
    if (!hasBackendIntegration) {
      onReport?.(reasonId);
      Toast.show('Report submitted. Thank you.');
      resetAndClose();
      return;
    }

    logAction('report', reasonId);
    setIsLoading(true);

    try {
      await reportMutation({
        authUserId: currentUserId!,
        reportedUserId: targetUserId as any,
        reason: reasonId,
      });

      Toast.show('Report submitted. Thank you.');
      resetAndClose();
    } catch (error: any) {
      setIsLoading(false);
      Alert.alert('Error', error.message || 'Failed to submit report.');
    }
  };

  // Submit "Other" reason with description
  const handleOtherSubmit = async () => {
    const trimmed = otherReason.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter a reason');
      return;
    }

    // Legacy mode: use callback if no backend integration
    if (!hasBackendIntegration) {
      onReport?.(`other: ${trimmed}`);
      Toast.show('Report submitted. Thank you.');
      resetAndClose();
      return;
    }

    logAction('report', `other: ${trimmed}`);
    setIsLoading(true);

    try {
      await reportMutation({
        authUserId: currentUserId!,
        reportedUserId: targetUserId as any,
        reason: 'other',
        description: trimmed,
      });

      Toast.show('Report submitted. Thank you.');
      resetAndClose();
    } catch (error: any) {
      setIsLoading(false);
      Alert.alert('Error', error.message || 'Failed to submit report.');
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    if (viewState === 'other') {
      setOtherReason('');
      setViewState('report');
    } else if (viewState === 'report') {
      setViewState('main');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Main action menu
  // ═══════════════════════════════════════════════════════════════════════════
  const renderMain = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{targetName}</Text>
        <TouchableOpacity onPress={resetAndClose} hitSlop={8}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Leave Conversation - only shown for private chats (with backend integration) */}
      {hasBackendIntegration && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={handleLeave}>
            <View style={[styles.actionIcon, { backgroundColor: C.surface }]}>
              <Ionicons name="exit-outline" size={20} color={C.textLight} />
            </View>
            <View style={styles.actionInfo}>
              <Text style={styles.actionText}>Leave Conversation</Text>
              <Text style={styles.actionHint}>Remove from your messages</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />
        </>
      )}

      {/* Block */}
      <TouchableOpacity style={styles.actionRow} onPress={handleBlock}>
        <View style={[styles.actionIcon, { backgroundColor: '#FF3B3020' }]}>
          <Ionicons name="ban" size={20} color="#FF3B30" />
        </View>
        <View style={styles.actionInfo}>
          <Text style={[styles.actionText, { color: '#FF3B30' }]}>Block</Text>
          <Text style={styles.actionHint}>They can't contact you anymore</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Report */}
      <TouchableOpacity style={styles.actionRow} onPress={() => setViewState('report')}>
        <View style={[styles.actionIcon, { backgroundColor: '#FF950020' }]}>
          <Ionicons name="flag-outline" size={20} color="#FF9500" />
        </View>
        <View style={styles.actionInfo}>
          <Text style={[styles.actionText, { color: '#FF9500' }]}>Report</Text>
          <Text style={styles.actionHint}>Report inappropriate behavior</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.textLight} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Report reasons list
  // ═══════════════════════════════════════════════════════════════════════════
  const renderReportReasons = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Report {targetName}</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.subtitle}>Why are you reporting this user?</Text>

      {REPORT_REASONS.map((reason, index) => (
        <React.Fragment key={reason.id}>
          {index > 0 && <View style={styles.divider} />}
          <TouchableOpacity
            style={styles.reasonRow}
            onPress={() => handleReportReason(reason.id)}
            disabled={isLoading}
          >
            <View style={[styles.actionIcon, { backgroundColor: C.surface }]}>
              <Ionicons name={reason.icon} size={18} color={C.textLight} />
            </View>
            <Text style={styles.actionText}>{reason.label}</Text>
            {reason.id === 'other' && (
              <Ionicons name="chevron-forward" size={18} color={C.textLight} />
            )}
            {isLoading && reason.id !== 'other' && (
              <ActivityIndicator size="small" color={C.primary} />
            )}
          </TouchableOpacity>
        </React.Fragment>
      ))}

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Other reason text input
  // ═══════════════════════════════════════════════════════════════════════════
  const renderOtherInput = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Other Reason</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.subtitle}>Please describe the issue</Text>

      <TextInput
        style={styles.otherInput}
        placeholder="Enter your reason..."
        placeholderTextColor={C.textLight}
        value={otherReason}
        onChangeText={setOtherReason}
        multiline
        maxLength={300}
        autoFocus
        editable={!isLoading}
      />

      <Text style={styles.charCount}>{otherReason.length}/300</Text>

      <View style={styles.otherButtons}>
        <TouchableOpacity style={styles.otherCancelBtn} onPress={handleBack}>
          <Text style={styles.otherCancelText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.otherSubmitBtn, (!otherReason.trim() || isLoading) && styles.otherSubmitDisabled]}
          onPress={handleOtherSubmit}
          disabled={!otherReason.trim() || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.otherSubmitText}>Submit Report</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // Render current view
  const renderCurrentView = () => {
    switch (viewState) {
      case 'report':
        return renderReportReasons();
      case 'other':
        return renderOtherInput();
      default:
        return renderMain();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (viewState === 'other') {
          handleBack();
        } else if (viewState === 'report') {
          handleBack();
        } else {
          resetAndClose();
        }
      }}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => {
            if (viewState === 'main') {
              resetAndClose();
            } else {
              Keyboard.dismiss();
            }
          }}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {renderCurrentView()}
        </View>
      </View>
    </Modal>
  );
}

const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surface,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    flex: 1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionInfo: {
    flex: 1,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
  },
  actionHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  divider: {
    height: 1,
    backgroundColor: C.surface,
  },
  cancelButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelText: {
    fontSize: 15,
    color: C.textLight,
    fontWeight: '500',
  },
  // Other input styles
  otherInput: {
    borderWidth: 1,
    borderColor: C.surface,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: C.text,
    minHeight: 100,
    maxHeight: 150,
    textAlignVertical: 'top',
    backgroundColor: C.surface,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  otherButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  otherCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.surface,
    alignItems: 'center',
  },
  otherCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textLight,
  },
  otherSubmitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
  },
  otherSubmitDisabled: {
    opacity: 0.5,
  },
  otherSubmitText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
