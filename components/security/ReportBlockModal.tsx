import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Id } from "@/convex/_generated/dataModel";

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

// MENU-CLEANUP: Final user-facing actions only — Unmatch / Block / Report / Scam.
// (Spam, Other, Uncrush rows removed.)
type ActionType = 'unmatch' | 'block' | 'report' | 'scam';

// MENU-CLEANUP: Final 4 report reasons only.
type ReportReasonId =
  | 'fake_profile'
  | 'inappropriate_photos'
  | 'harassment'
  | 'underage';

const REPORT_REASONS: ReadonlyArray<{
  id: ReportReasonId;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  { id: 'fake_profile', label: 'Fake profile', icon: 'person-remove-outline' },
  { id: 'inappropriate_photos', label: 'Inappropriate photos', icon: 'warning-outline' },
  { id: 'harassment', label: 'Harassment', icon: 'hand-left-outline' },
  { id: 'underage', label: 'Underage', icon: 'alert-circle-outline' },
];

type ViewState = 'main' | 'report';

const asUserId = (value: string): Id<'users'> => value as Id<'users'>;
const asMatchId = (value: string): Id<'matches'> => value as Id<'matches'>;
const getSafeIdTail = (value?: string | null): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(-6) : undefined;
const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

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
  const [viewState, setViewState] = useState<ViewState>('main');
  const insets = useSafeAreaInsets();
  const bottomClearance = Math.max(16, insets.bottom + 12);

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
        userRef: getSafeIdTail(reportedUserId),
        conversationRef: getSafeIdTail(conversationId),
        timestamp: new Date().toISOString(),
        ...(reason ? { reason } : {}),
      });
    }
  };

  const resetAndClose = () => {
    setViewState('main');
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
                matchId: asMatchId(matchId),
                authUserId: currentUserId,
              });
              Toast.show(`Unmatched with ${reportedUserName}`);
              resetAndClose();
              onUnmatchSuccess?.();
            } catch (error: unknown) {
              Alert.alert("Error", getErrorMessage(error, "Failed to unmatch."));
            }
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
        blockedUserId: asUserId(reportedUserId),
      });
      resetAndClose();
      Toast.show(`${reportedUserName} blocked`);
      onBlockSuccess?.();
    } catch (error: unknown) {
      Alert.alert("Error", getErrorMessage(error, "Failed to block user."));
    }
  };

  // Report reason: submit selected category to backend
  const handleReportReason = async (reason: ReportReasonId) => {
    logAction('report', reason);
    if (isDemoMode) {
      Toast.show("Report submitted");
      resetAndClose();
      return;
    }

    try {
      await reportMutation({
        authUserId: currentUserId,
        reportedUserId: asUserId(reportedUserId),
        reason,
      });
      Toast.show("Report submitted");
      resetAndClose();
    } catch (error: unknown) {
      Alert.alert("Error", getErrorMessage(error, "Failed to submit report."));
    }
  };

  // Scam: frontend-only mapping to backend `other` reason with description.
  // No new backend literal is added — the `reports` audit row just records
  // `reason: 'other'` + description so moderators can see the user-facing label.
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
        reportedUserId: asUserId(reportedUserId),
        reason: 'other',
        description: 'Scam/fraudulent behavior',
      });
      Toast.show("Reported as scam");
      resetAndClose();
    } catch (error: unknown) {
      Alert.alert("Error", getErrorMessage(error, "Failed to submit report."));
    }
  };

  // Main action sheet — Unmatch / Block / Report / Scam / Cancel
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

      {/* Block */}
      <TouchableOpacity style={styles.actionRow} onPress={handleBlock}>
        <Ionicons name="ban" size={20} color={COLORS.error} />
        <Text style={[styles.actionText, { color: COLORS.error }]}>Block</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Report — opens reason picker */}
      <TouchableOpacity style={styles.actionRow} onPress={() => setViewState('report')}>
        <Ionicons name="flag-outline" size={20} color={COLORS.warning} />
        <Text style={[styles.actionText, { color: COLORS.warning }]}>Report</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Scam — quick action, frontend-only mapping to other+description */}
      <TouchableOpacity style={styles.actionRow} onPress={handleScam}>
        <Ionicons name="alert-circle-outline" size={20} color={COLORS.textLight} />
        <Text style={styles.actionText}>Scam</Text>
      </TouchableOpacity>

      {/* Cancel */}
      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // Report reason sub-view — 4 reasons (no Spam, no Other)
  const renderReportReasons = () => (
    <View style={styles.content}>
      <View style={styles.reportHeader}>
        <TouchableOpacity onPress={() => setViewState('main')} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.reportTitle}>Report {reportedUserName}</Text>
        <View style={{ width: 22 }} />
      </View>

      {REPORT_REASONS.map((reason, index) => (
        <React.Fragment key={reason.id}>
          {index > 0 && <View style={styles.divider} />}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => handleReportReason(reason.id)}
          >
            <Ionicons name={reason.icon} size={20} color={COLORS.textLight} />
            <Text style={styles.actionText}>{reason.label}</Text>
          </TouchableOpacity>
        </React.Fragment>
      ))}

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={resetAndClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={resetAndClose}
      >
        <TouchableOpacity
          style={[styles.sheet, { marginBottom: bottomClearance }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          {viewState === 'report' ? renderReportReasons() : renderMain()}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // PREMIUM-MENU: No dim/blur overlay. Backdrop is fully transparent so the
  // chat remains fully visible behind the floating action card. Tap-outside
  // still dismisses (the TouchableOpacity fills the screen), but visually
  // it feels like a lightweight floating menu, not a modal.
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  // PREMIUM-MENU: Floating rounded card with margin on all sides + soft
  // shadow. No full-width edge-to-edge sheet — sits inset from the screen
  // edges so it feels like an elegant floating popover.
  sheet: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    marginHorizontal: 12,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 14,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.04)",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 6,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    gap: 14,
  },
  actionText: {
    fontSize: 15.5,
    fontWeight: "500",
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: -4,
  },
  cancelButton: {
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  cancelText: {
    fontSize: 15.5,
    fontWeight: "600",
    color: COLORS.textLight,
  },
  // Report sub-view header
  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    marginBottom: 4,
  },
  reportTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
  },
});
