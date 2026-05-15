/**
 * Phase 2 Report/Block/Unmatch Modal
 *
 * MENU-CLEANUP: Final user-facing actions only — Unmatch / Block / Report /
 * Scam / Cancel. Report sub-view exposes 4 reasons (no Spam, no Other).
 * Scam is a frontend-only quick action that maps to backend
 * `reportUser({ reason: 'other', description: 'Scam/fraudulent behavior' })`.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Keyboard,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { Toast } from '@/components/ui/Toast';
import { trackEvent } from '@/lib/analytics';
import { useAuthStore } from '@/stores/authStore';

// P2-3: Friendly rate-limit copy derived from backend retryAfterMs.
const formatRateLimitMessage = (retryAfterMs?: number): string => {
  const seconds = Math.min(60, Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000)));
  return `Slow down. Please try again in ${seconds}s.`;
};

// P2-6: Reasons reconciled with backend `users.reportUser` literal union.
// Spam and Other were missing from the UI; Other requires a free-text
// description (collected in a sub-view) before submission.
const REPORT_REASONS = [
  { id: 'fake_profile', label: 'Fake profile', icon: 'person-remove-outline' as const },
  { id: 'inappropriate_photos', label: 'Inappropriate photos', icon: 'warning-outline' as const },
  { id: 'harassment', label: 'Harassment', icon: 'hand-left-outline' as const },
  { id: 'spam', label: 'Spam', icon: 'mail-unread-outline' as const },
  { id: 'underage', label: 'Underage', icon: 'alert-circle-outline' as const },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
] as const;

type ReportReason = typeof REPORT_REASONS[number]['id'];
type ViewState = 'main' | 'report' | 'other_description';
const OTHER_DESCRIPTION_MIN = 5;
const OTHER_DESCRIPTION_MAX = 500;

interface ReportModalProps {
  visible: boolean;
  targetName: string;
  // Required for backend integration; optional for demo/public rooms
  targetUserId?: string;
  authToken?: string;
  conversationId?: string;
  onClose: () => void;
  onBlockSuccess?: () => void;
  // Fired on successful Unmatch (kept name for backwards compat with callers)
  onLeaveSuccess?: () => void;
  // Legacy callbacks for backward compatibility (used when targetUserId/authToken not provided)
  onReport?: (reason: string) => void;
  onBlock?: () => void;
}

export function ReportModal({
  visible,
  targetName,
  targetUserId,
  authToken,
  conversationId,
  onClose,
  onBlockSuccess,
  onLeaveSuccess,
  // Legacy callbacks
  onReport,
  onBlock,
}: ReportModalProps) {
  // Get userId for backend mutations
  const userId = useAuthStore((s) => s.userId);
  const storeToken = useAuthStore((s) => s.token);
  const token = authToken || storeToken;
  // Determine if we have full backend integration or using legacy mode
  const hasBackendIntegration = !!(targetUserId && token);
  const [viewState, setViewState] = useState<ViewState>('main');
  const [isLoading, setIsLoading] = useState(false);
  // P2-6: Free-text description for the 'Other' reason. Cleared on reset.
  const [otherDescription, setOtherDescription] = useState('');

  // Backend mutations (Phase-2 isolation: privateSwipes / privateConversations
  // for the match graph; api.users for shared block/report tables).
  const blockMutation = useMutation(api.users.blockUser);
  const reportMutation = useMutation(api.users.reportUser);
  const unmatchPrivateMutation = useMutation(api.privateSwipes.unmatchPrivate);
  const leaveMutation = useMutation(api.privateConversations.leavePrivateConversation);

  // Track action with analytics
  type ChatActionType = 'unmatch' | 'uncrush' | 'block' | 'report' | 'spam' | 'scam' | 'inappropriate' | 'other';
  const logAction = (action: string, reason?: string) => {
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
    setIsLoading(false);
    setOtherDescription('');
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
              if (!token || !userId) {
                Alert.alert('Error', 'Please log in to block users.');
                setIsLoading(false);
                return;
              }
              // P1-3: backend now requires (token, authUserId).
              // P2-3: blockUser returns a discriminated result — handle
              // failure shapes explicitly instead of always treating the
              // call as successful.
              const result = await blockMutation({
                token,
                authUserId: userId,
                blockedUserId: targetUserId as any,
              });

              if (result?.success === false) {
                setIsLoading(false);
                if (result.error === 'cannot_block_self') {
                  Alert.alert("Can't block", "You can't block your own account.");
                  return;
                }
                if (result.error === 'unauthorized') {
                  Alert.alert('Error', 'Session expired. Please sign in again.');
                  return;
                }
                Alert.alert('Error', 'Failed to block user.');
                return;
              }

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
  // UNMATCH: Phase-2 Unmatch path. Calls api.privateSwipes.unmatchPrivate to
  // flip privateMatches.isActive=false + caller's participantState.isHidden
  // true, then best-effort leavePrivateConversation so the row drops off the
  // chat list immediately. Phase-1 tables are NEVER touched.
  // ═══════════════════════════════════════════════════════════════════════════
  const handleUnmatch = () => {
    Alert.alert(
      'Unmatch?',
      `This will remove your match and close the conversation with ${targetName}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            logAction('unmatch');
            setIsLoading(true);

            try {
              if (!userId || !token || !conversationId) {
                throw new Error('Missing authentication or conversation ID');
              }

              const result = await unmatchPrivateMutation({
                token,
                authUserId: userId,
                conversationId: conversationId as any,
              });

              if (!result?.success) {
                throw new Error((result as any)?.error || 'Failed to unmatch');
              }

              // Best-effort hide via leavePrivateConversation so the chat list
              // drops the row immediately (unmatch already flipped isActive).
              try {
                const { useAuthStore } = await import('@/stores/authStore');
                const token = useAuthStore.getState().token;
                if (token) {
                  await leaveMutation({
                    token,
                    conversationId: conversationId as any,
                  });
                }
              } catch {
                // best-effort
              }

              // Also remove from local store for immediate UI feedback
              const { usePrivateChatStore } = await import('@/stores/privateChatStore');
              usePrivateChatStore.getState().removeConversation(conversationId);

              Toast.show(`Unmatched with ${targetName}`);
              resetAndClose();
              onLeaveSuccess?.();
            } catch (error: any) {
              setIsLoading(false);
              Alert.alert('Error', error.message || 'Failed to unmatch.');
            }
          },
        },
      ]
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT: Persist to backend with reason (Phase 1 parity) or use legacy callback
  // P2-3 / P2-6 / P2-8: Shared submit path for picker reasons + Scam quick
  // action. Inspects the discriminated result from `users.reportUser` to
  // honestly surface rate-limit / dedupe / self-report errors instead of
  // pretending success.
  // ═══════════════════════════════════════════════════════════════════════════
  const submitReport = async (
    reason: ReportReason,
    description: string | undefined,
    successToast: string,
    analyticsAction: 'report' | 'scam',
  ) => {
    if (isLoading) return;
    if (!hasBackendIntegration) {
      onReport?.(analyticsAction === 'scam' ? 'scam' : reason);
      Toast.show(successToast);
      resetAndClose();
      return;
    }

    logAction(analyticsAction, reason);
    setIsLoading(true);

    try {
      if (!token || !userId) {
        Alert.alert('Error', 'Please log in to report users.');
        setIsLoading(false);
        return;
      }
      // P1-3 / P1-6: pass authUserId + source.
      const result = await reportMutation({
        token,
        authUserId: userId,
        reportedUserId: targetUserId as any,
        reason,
        description,
        source: 'chat',
      });

      if (result?.success === false) {
        setIsLoading(false);
        if (result.error === 'rate_limited') {
          Toast.show(formatRateLimitMessage(result.retryAfterMs));
          return;
        }
        if (result.error === 'duplicate_recent_report') {
          Toast.show("You've already reported this user recently.");
          resetAndClose();
          return;
        }
        if (result.error === 'cannot_report_self') {
          Alert.alert("Can't report", "You can't report your own account.");
          return;
        }
        if (result.error === 'description_too_long') {
          Alert.alert('Too long', 'Please keep the description under 500 characters.');
          return;
        }
        Alert.alert('Error', 'Failed to submit report.');
        return;
      }

      Toast.show(successToast);
      resetAndClose();
    } catch (error: any) {
      setIsLoading(false);
      Alert.alert('Error', error.message || 'Failed to submit report.');
    }
  };

  // P2-6: 'Other' opens the description sub-view; all other reasons submit
  // immediately.
  const handleReportReason = (reasonId: ReportReason) => {
    if (reasonId === 'other') {
      setViewState('other_description');
      return;
    }
    // P2-8: friendlier review-acknowledgement copy.
    void submitReport(reasonId, undefined, "Thanks — we'll review this report.", 'report');
  };

  // P2-6: Submit handler for the 'Other' description sub-view.
  const handleSubmitOtherDescription = () => {
    const trimmed = otherDescription.trim();
    if (trimmed.length < OTHER_DESCRIPTION_MIN) {
      Alert.alert('Add a bit more', `Please describe the issue (at least ${OTHER_DESCRIPTION_MIN} characters).`);
      return;
    }
    void submitReport('other', trimmed, "Thanks — we'll review this report.", 'report');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAM: Frontend-only quick action. Maps to backend `reason: 'other'` +
  // description so no new backend literal is required. Moderators see the
  // descriptive label in the audit row.
  // ═══════════════════════════════════════════════════════════════════════════
  const handleScam = () => {
    void submitReport('other', 'Scam/fraudulent behavior', 'Reported as scam', 'scam');
  };

  const handleBack = () => {
    Keyboard.dismiss();
    if (viewState === 'report') {
      setViewState('main');
    } else if (viewState === 'other_description') {
      // P2-6: return to the reasons list so the user can pick a different
      // reason without losing the modal.
      setViewState('report');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Main action menu — Unmatch / Block / Report / Scam / Cancel
  // ═══════════════════════════════════════════════════════════════════════════
  const renderMain = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{targetName}</Text>
        <TouchableOpacity onPress={resetAndClose} hitSlop={8}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Unmatch — only shown for matched/private chats with backend wiring */}
      {hasBackendIntegration && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={handleUnmatch}>
            <View style={[styles.actionIcon, { backgroundColor: C.surface }]}>
              <Ionicons name="close-circle-outline" size={20} color={C.textLight} />
            </View>
            <View style={styles.actionInfo}>
              <Text style={styles.actionText}>Unmatch</Text>
              <Text style={styles.actionHint}>Remove match and conversation</Text>
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

      {/* Report — opens 4-reason picker */}
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

      <View style={styles.divider} />

      {/* Scam — frontend-only quick action */}
      <TouchableOpacity style={styles.actionRow} onPress={handleScam}>
        <View style={[styles.actionIcon, { backgroundColor: C.surface }]}>
          <Ionicons name="alert-circle-outline" size={20} color={C.textLight} />
        </View>
        <View style={styles.actionInfo}>
          <Text style={styles.actionText}>Scam</Text>
          <Text style={styles.actionHint}>Report fraudulent behavior</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Report reasons list — MENU-CLEANUP: 4 reasons only
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
            {isLoading && (
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

  // P2-6: 'Other' description sub-view. Requires a short non-empty
  // description before submission so moderators have something actionable.
  const renderOtherDescription = () => {
    const trimmedLength = otherDescription.trim().length;
    const submitDisabled = isLoading || trimmedLength < OTHER_DESCRIPTION_MIN;
    return (
      <View style={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8} disabled={isLoading}>
            <Ionicons name="chevron-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Other</Text>
          <View style={{ width: 24 }} />
        </View>

        <Text style={styles.subtitle}>
          Briefly describe the issue so our team can review it.
        </Text>

        <TextInput
          style={styles.otherInput}
          value={otherDescription}
          onChangeText={setOtherDescription}
          placeholder="What happened?"
          placeholderTextColor={C.textLight}
          multiline
          maxLength={OTHER_DESCRIPTION_MAX}
          editable={!isLoading}
          autoFocus
        />
        <Text style={styles.otherCounter}>
          {trimmedLength}/{OTHER_DESCRIPTION_MAX}
        </Text>

        <TouchableOpacity
          style={[styles.submitButton, submitDisabled && styles.submitButtonDisabled]}
          onPress={handleSubmitOtherDescription}
          disabled={submitDisabled}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>Submit report</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Render current view
  const renderCurrentView = () => {
    switch (viewState) {
      case 'report':
        return renderReportReasons();
      case 'other_description':
        return renderOtherDescription();
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
        // P2-6: also walk back from the Other description sub-view via the
        // existing handleBack chain instead of dumping the user to the main
        // sheet on Android hardware-back.
        if (viewState === 'report' || viewState === 'other_description') {
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
  // P2-6: 'Other' description sub-view styles.
  otherInput: {
    minHeight: 96,
    maxHeight: 180,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: C.text,
    textAlignVertical: 'top',
  },
  otherCounter: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginBottom: 10,
    fontSize: 11.5,
    color: C.textLight,
  },
  submitButton: {
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#FF9500',
    borderRadius: 12,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
