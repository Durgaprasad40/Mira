import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { Toast } from "@/components/ui/Toast";
import { trackEvent } from "@/lib/analytics";

interface Props {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  currentUserId: string;
  conversationId?: string;
  matchId?: string; // For unmatch functionality
  onBlockSuccess?: () => void;
  onUnmatchSuccess?: () => void;
}

type ActionType = 'unmatch' | 'uncrush' | 'block' | 'report' | 'spam' | 'scam' | 'other';

export function ReportBlockModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  currentUserId,
  conversationId,
  matchId,
  onBlockSuccess,
  onUnmatchSuccess,
}: Props) {
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherReason, setOtherReason] = useState("");

  const blockMutation = useMutation(api.users.blockUser);
  const reportMutation = useMutation(api.users.reportUser);
  const unmatchMutation = useMutation(api.matches.unmatch);

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
    setShowOtherInput(false);
    setOtherReason("");
    onClose();
  };

  // Unmatch: confirm dialog then remove match (separate from block)
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
              // Demo mode: remove match and conversation
              useDemoStore.getState().removeMatch(reportedUserId);
              Toast.show(`Unmatched with ${reportedUserName}`);
              resetAndClose();
              onUnmatchSuccess?.();
              return;
            }

            // Convex mode: call unmatch mutation
            if (!matchId) {
              Alert.alert("Error", "Cannot unmatch: match information not available.");
              return;
            }

            try {
              // AUTH FIX: Pass authUserId for server-side resolution
              await unmatchMutation({
                matchId: matchId as any,
                authUserId: currentUserId,
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
          onPress: () => {
            logAction('uncrush');
            if (isDemoMode) {
              useDemoStore.getState().removeLike(reportedUserId);
            }
            Toast.show(`Removed crush on ${reportedUserName}`);
            resetAndClose();
          },
        },
      ]
    );
  };

  // Block: keep existing behavior
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
      await blockMutation({
        authUserId: currentUserId,
        blockedUserId: reportedUserId as any,
      });
      resetAndClose();
      Toast.show(`${reportedUserName} blocked`);
      onBlockSuccess?.();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to block user.");
    }
  };

  // Report: submit to backend
  const handleReport = async () => {
    logAction('report');
    if (isDemoMode) {
      Toast.show("Report submitted");
      resetAndClose();
      return;
    }

    try {
      await reportMutation({
        authUserId: currentUserId,
        reportedUserId: reportedUserId as any,
        reason: 'inappropriate_photos',
      });
      Toast.show("Report submitted");
      resetAndClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  // Spam: submit to backend
  const handleSpam = async () => {
    logAction('spam');
    if (isDemoMode) {
      Toast.show("Marked as spam");
      resetAndClose();
      return;
    }

    try {
      await reportMutation({
        authUserId: currentUserId,
        reportedUserId: reportedUserId as any,
        reason: 'spam',
      });
      Toast.show("Marked as spam");
      resetAndClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  // Scam: submit to backend (maps to 'other' with description)
  const handleScam = async () => {
    logAction('scam');
    if (isDemoMode) {
      Toast.show("Reported as scam");
      resetAndClose();
      return;
    }

    try {
      await reportMutation({
        authUserId: currentUserId,
        reportedUserId: reportedUserId as any,
        reason: 'other',
        description: 'Scam/fraudulent behavior',
      });
      Toast.show("Reported as scam");
      resetAndClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  // Other: open text input modal
  const handleOtherPress = () => {
    setShowOtherInput(true);
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
      Toast.show("Feedback submitted");
      resetAndClose();
      return;
    }

    try {
      await reportMutation({
        authUserId: currentUserId,
        reportedUserId: reportedUserId as any,
        reason: 'other',
        description: trimmed,
      });
      Toast.show("Feedback submitted");
      resetAndClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  const handleOtherCancel = () => {
    setShowOtherInput(false);
    setOtherReason("");
  };

  // Main action sheet
  const renderMain = () => (
    <View style={styles.content}>
      {/* Unmatch - only show if there's a matchId (matched users) */}
      {matchId && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={handleUnmatch}>
            <Ionicons name="close-circle-outline" size={20} color={COLORS.textLight} />
            <Text style={styles.actionText}>Unmatch</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
        </>
      )}

      {/* Uncrush */}
      <TouchableOpacity style={styles.actionRow} onPress={handleUncrush}>
        <Ionicons name="heart-dislike-outline" size={20} color={COLORS.textLight} />
        <Text style={styles.actionText}>Uncrush</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Block */}
      <TouchableOpacity style={styles.actionRow} onPress={handleBlock}>
        <Ionicons name="ban" size={20} color={COLORS.error} />
        <Text style={[styles.actionText, { color: COLORS.error }]}>Block</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Report */}
      <TouchableOpacity style={styles.actionRow} onPress={handleReport}>
        <Ionicons name="flag-outline" size={20} color={COLORS.warning} />
        <Text style={[styles.actionText, { color: COLORS.warning }]}>Report</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Spam */}
      <TouchableOpacity style={styles.actionRow} onPress={handleSpam}>
        <Ionicons name="megaphone-outline" size={20} color={COLORS.textLight} />
        <Text style={styles.actionText}>Spam</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Scam */}
      <TouchableOpacity style={styles.actionRow} onPress={handleScam}>
        <Ionicons name="alert-circle-outline" size={20} color={COLORS.textLight} />
        <Text style={styles.actionText}>Scam</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Other */}
      <TouchableOpacity style={styles.actionRow} onPress={handleOtherPress}>
        <Ionicons name="ellipsis-horizontal" size={20} color={COLORS.textLight} />
        <Text style={styles.actionText}>Other</Text>
      </TouchableOpacity>

      {/* Cancel */}
      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // Other input modal (nested within the same overlay)
  const renderOtherInput = () => (
    <View style={styles.otherInputContainer}>
      <Text style={styles.otherTitle}>Tell us more</Text>
      <TextInput
        style={styles.otherInput}
        placeholder="Enter your reason..."
        placeholderTextColor={COLORS.textMuted}
        value={otherReason}
        onChangeText={setOtherReason}
        multiline
        maxLength={300}
        autoFocus
        autoComplete="off"
        textContentType="none"
        importantForAutofill="noExcludeDescendants"
      />
      <View style={styles.otherButtons}>
        <TouchableOpacity style={styles.otherCancelBtn} onPress={handleOtherCancel}>
          <Text style={styles.otherCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.otherSubmitBtn, !otherReason.trim() && styles.otherSubmitDisabled]}
          onPress={handleOtherSubmit}
          disabled={!otherReason.trim()}
        >
          <Text style={styles.otherSubmitText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={resetAndClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={resetAndClose}
      >
        <TouchableOpacity
          style={styles.sheet}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          {showOtherInput ? renderOtherInput() : renderMain()}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
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
  // Other input styles
  otherInputContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  otherTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 12,
  },
  otherInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  otherButtons: {
    flexDirection: "row",
    gap: 12,
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
