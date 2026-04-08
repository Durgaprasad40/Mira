import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Pressable,
  BackHandler,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { Toast } from "@/components/ui/Toast";
import { trackEvent } from "@/lib/analytics";
import { useEffect } from "react";

interface Props {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  authToken?: string;
  conversationId?: string;
  matchId?: string;
  onBlockSuccess?: () => void;
  onUnmatchSuccess?: () => void;
}

type ActionType = 'unmatch' | 'uncrush' | 'block' | 'report' | 'inappropriate' | 'other';
type ViewState = 'main' | 'report' | 'other';

// Report reason options (simplified for messages context)
const REPORT_REASONS = [
  { key: 'inappropriate', label: 'Inappropriate behavior', icon: 'warning-outline' as const },
  { key: 'other', label: 'Something else', icon: 'ellipsis-horizontal' as const },
];

export function ReportBlockModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  authToken,
  conversationId,
  matchId,
  onBlockSuccess,
  onUnmatchSuccess,
}: Props) {
  const [viewState, setViewState] = useState<ViewState>('main');
  const [otherReason, setOtherReason] = useState("");

  const blockMutation = useMutation(api.users.blockUser);
  const reportMutation = useMutation(api.users.reportUser);
  const unmatchMutation = useMutation(api.matches.unmatch);
  const uncrushMutation = useMutation(api.likes.uncrush);
  const isLiveChatContext = !!conversationId;
  const canUnmatch = isLiveChatContext && !!matchId;
  const canUncrush = !isLiveChatContext;

  const requireLiveToken = () => {
    if (!authToken) {
      Alert.alert("Error", "Session expired. Please log in again.");
      return null;
    }
    return authToken;
  };

  // Handle Android back button - navigate within views before closing
  useEffect(() => {
    if (!visible) return;

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewState === 'other') {
        Keyboard.dismiss();
        setOtherReason("");
        setViewState('report');
        return true; // Prevent default back behavior
      } else if (viewState === 'report') {
        setViewState('main');
        return true;
      }
      // viewState === 'main' - let modal close
      return false;
    });

    return () => backHandler.remove();
  }, [visible, viewState]);

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setViewState('main');
      setOtherReason("");
    }
  }, [visible]);

  // Track action with standard payload
  const logAction = (action: ActionType, reason?: string) => {
    trackEvent({
      name: 'chat_action',
      action,
      userId: reportedUserId,
      conversationId,
      timestamp: Date.now(),
      ...(reason ? { reason } : {}),
    });
    if (__DEV__) {
      console.log(`[ChatAction] ${action}`, {
        userId: reportedUserId,
        conversationId,
        timestamp: new Date().toISOString(),
        ...(reason ? { reason } : {}),
      });
    }
  };

  const resetAndClose = () => {
    Keyboard.dismiss();
    setViewState('main');
    setOtherReason("");
    onClose();
  };

  // Handle modal close request (Android back when on main view)
  const handleRequestClose = () => {
    if (viewState === 'other') {
      Keyboard.dismiss();
      setOtherReason("");
      setViewState('report');
    } else if (viewState === 'report') {
      setViewState('main');
    } else {
      resetAndClose();
    }
  };

  // Unmatch: confirm dialog then remove match
  const handleUnmatch = () => {
    Alert.alert(
      "Unmatch?",
      `This will remove your match and close the conversation. ${reportedUserName} will no longer appear in your matches.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unmatch",
          style: "destructive",
          onPress: async () => {
            logAction('unmatch');
            if (isDemoMode) {
              useDemoStore.getState().removeMatch(reportedUserId);
              Toast.show(`Unmatched with ${reportedUserName}`);
              resetAndClose();
              onUnmatchSuccess?.();
              return;
            }

            if (!matchId) {
              Alert.alert("Error", "Cannot unmatch: match information not available.");
              return;
            }

            try {
              const token = requireLiveToken();
              if (!token) return;
              await unmatchMutation({
                matchId: matchId as any,
                token,
              });
              Toast.show(`Unmatched with ${reportedUserName}`);
              resetAndClose();
              onUnmatchSuccess?.();
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to unmatch.");
            }
          },
        },
      ]
    );
  };

  // Uncrush: confirm dialog then remove like
  const handleUncrush = () => {
    Alert.alert(
      "Uncrush",
      `Are you sure you want to remove your crush on ${reportedUserName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes",
          onPress: async () => {
            logAction('uncrush');
            if (isDemoMode) {
              useDemoStore.getState().removeLike(reportedUserId);
              Toast.show(`Removed crush on ${reportedUserName}`);
              resetAndClose();
              return;
            }

            const token = requireLiveToken();
            if (!token) {
              return;
            }

            try {
              await uncrushMutation({
                token,
                targetUserId: reportedUserId as any,
              });
              Toast.show(`Removed crush on ${reportedUserName}`);
              resetAndClose();
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to remove crush.");
            }
          },
        },
      ]
    );
  };

  // Block: persist to backend AND update local store
  const handleBlock = async () => {
    logAction('block');
    if (isDemoMode) {
      useDemoStore.getState().blockUser(reportedUserId);
      resetAndClose();
      Toast.show(`${reportedUserName} blocked`);
      onBlockSuccess?.();
      return;
    }

    try {
      const token = requireLiveToken();
      if (!token) return;
      await blockMutation({
        token,
        blockedUserId: reportedUserId as any,
      });
      const { useBlockStore } = await import('@/stores/blockStore');
      useBlockStore.getState().blockUser(reportedUserId);
      resetAndClose();
      Toast.show(`${reportedUserName} blocked`);
      onBlockSuccess?.();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to block user.");
    }
  };

  // Open report reasons view
  const handleReportPress = () => {
    setViewState('report');
  };

  // Handle report reason selection
  const handleReportReason = async (reasonKey: string) => {
    if (reasonKey === 'other') {
      setViewState('other');
      return;
    }

    const reasonMap: Record<string, { reason: string; description?: string }> = {
      'inappropriate': { reason: 'inappropriate_photos' },
    };

    const reportData = reasonMap[reasonKey];
    if (!reportData) return;

    logAction(reasonKey as ActionType);

    if (isDemoMode) {
      Toast.show("Report submitted");
      resetAndClose();
      return;
    }

    try {
      const token = requireLiveToken();
      if (!token) return;
      await reportMutation({
        token,
        reportedUserId: reportedUserId as any,
        reason: reportData.reason as any,
        ...(reportData.description ? { description: reportData.description } : {}),
      });
      Toast.show("Report submitted");
      resetAndClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  // Submit Other reason
  const handleOtherSubmit = async () => {
    const trimmed = otherReason.trim();
    if (!trimmed) {
      Alert.alert("Required", "Please enter a reason");
      return;
    }
    logAction('other', trimmed);

    if (isDemoMode) {
      Toast.show("Report submitted");
      resetAndClose();
      return;
    }

    try {
      const token = requireLiveToken();
      if (!token) return;
      await reportMutation({
        token,
        reportedUserId: reportedUserId as any,
        reason: 'other',
        description: trimmed,
      });
      Toast.show("Report submitted");
      resetAndClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    if (viewState === 'other') {
      setOtherReason("");
      setViewState('report');
    } else if (viewState === 'report') {
      setViewState('main');
    }
  };

  // Main action sheet - minimal top-level options
  const renderMain = () => (
    <View style={styles.content}>
      <View style={styles.mainHeader}>
        <Text style={styles.mainTitle}>Safety options</Text>
        <Text style={styles.mainSubtitle}>
          Manage this conversation or let us know if something feels wrong.
        </Text>
      </View>
      {canUnmatch && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={handleUnmatch}>
            <Ionicons name="heart-dislike-outline" size={20} color={COLORS.textLight} />
            <Text style={styles.actionText}>Unmatch</Text>
          </TouchableOpacity>

          <View style={styles.divider} />
        </>
      )}

      {canUncrush && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={handleUncrush}>
            <Ionicons name="heart-dislike-outline" size={20} color={COLORS.textLight} />
            <Text style={styles.actionText}>Uncrush</Text>
          </TouchableOpacity>

          <View style={styles.divider} />
        </>
      )}

      <TouchableOpacity style={styles.actionRow} onPress={handleBlock}>
        <Ionicons name="ban" size={20} color={COLORS.error} />
        <Text style={[styles.actionText, { color: COLORS.error }]}>Block user</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity style={styles.actionRow} onPress={handleReportPress}>
        <Ionicons name="flag-outline" size={20} color={COLORS.warning} />
        <Text style={[styles.actionText, { color: COLORS.warning }]}>Report user</Text>
        <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} style={styles.chevron} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // Report reasons list
  const renderReportReasons = () => (
    <View style={styles.content}>
      <View style={styles.reportHeader}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.reportTitle}>Report {reportedUserName}</Text>
        <View style={styles.backButton} />
      </View>

      <Text style={styles.reportSubtitle}>Choose the reason that fits best.</Text>

      {REPORT_REASONS.map((reason, index) => (
        <React.Fragment key={reason.key}>
          {index > 0 && <View style={styles.divider} />}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => handleReportReason(reason.key)}
          >
            <Ionicons name={reason.icon} size={20} color={COLORS.textLight} />
            <Text style={styles.actionText}>{reason.label}</Text>
            {reason.key === 'other' && (
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} style={styles.chevron} />
            )}
          </TouchableOpacity>
        </React.Fragment>
      ))}

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // Other input view - fixed height layout that works with keyboard
  const renderOtherInput = () => (
    <View style={styles.otherContainer}>
      {/* Header */}
      <View style={styles.reportHeader}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.reportTitle}>Other Reason</Text>
        <View style={styles.backButton} />
      </View>

      <Text style={styles.otherSubtitle}>Share a few details so our team can review it.</Text>

      {/* Input area */}
      <TextInput
        style={styles.otherInput}
        placeholder="Tell us what happened..."
        placeholderTextColor={COLORS.textMuted}
        value={otherReason}
        onChangeText={setOtherReason}
        multiline
        maxLength={300}
        autoFocus
        autoComplete="off"
        textContentType="none"
      />

      <Text style={styles.charCount}>{otherReason.length}/300</Text>

      {/* Buttons */}
      <View style={styles.otherButtons}>
        <TouchableOpacity style={styles.otherCancelBtn} onPress={handleBack}>
          <Text style={styles.otherCancelText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.otherSubmitBtn, !otherReason.trim() && styles.otherSubmitDisabled]}
          onPress={handleOtherSubmit}
          disabled={!otherReason.trim()}
        >
          <Text style={styles.otherSubmitText}>Send report</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Render the current view
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
      onRequestClose={handleRequestClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalContainer}
      >
        {/* Backdrop - tap to close (only on main view) */}
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (viewState === 'main') {
              resetAndClose();
            } else if (viewState === 'report') {
              setViewState('main');
            } else {
              // On 'other' view, dismiss keyboard but don't close
              Keyboard.dismiss();
            }
          }}
        />

        {/* Sheet content */}
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {renderCurrentView()}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  mainHeader: {
    paddingTop: 4,
    paddingBottom: 10,
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  mainSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  actionText: {
    fontSize: 16,
    fontWeight: "500",
    color: COLORS.text,
    flex: 1,
  },
  chevron: {
    marginLeft: 'auto',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  cancelText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  // Report reasons header
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    flex: 1,
  },
  reportSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  // Other input styles
  otherContainer: {
    paddingBottom: 8,
  },
  otherSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  otherInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    maxHeight: 150,
    textAlignVertical: "top",
    marginHorizontal: 20,
    backgroundColor: COLORS.background,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  otherButtons: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
  },
  otherCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  otherCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textLight,
  },
  otherSubmitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  otherSubmitDisabled: {
    opacity: 0.5,
  },
  otherSubmitText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.white,
  },
});
