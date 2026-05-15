import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
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
import { useAuthStore } from "@/stores/authStore";
import type { Id } from "@/convex/_generated/dataModel";

// P2-3: Convert a backend retryAfterMs value into a friendly "slow down"
// message. Backend (`actionRateLimits.reserveActionSlots`) returns the
// milliseconds until the rate-limit window expires. We round up to the next
// whole second and cap the displayed value at 60s so the copy stays readable.
const formatRateLimitMessage = (retryAfterMs?: number): string => {
  const seconds = Math.min(60, Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000)));
  return `Slow down. Please try again in ${seconds}s.`;
};

export type ReportBlockSource =
  | 'chat'
  | 'profile'
  | 'discover'
  | 'vibes'
  | 'media'
  | 'confession'
  | 'unknown';

interface Props {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  currentUserId: string;
  source?: ReportBlockSource;
  conversationId?: string;
  matchId?: string; // For unmatch functionality
  onBlockSuccess?: () => void;
  onUnmatchSuccess?: () => void;
  // P2-4: Fired after a successful report submission (any reason, including
  // Scam quick-action). Callers launched from the Phase-1 discover profile
  // sheet use this to invalidate the in-memory deck card so the reported
  // profile doesn't pop back into view until the next fetch.
  onReportSuccess?: () => void;
}

// MENU-CLEANUP: Final user-facing actions only — Unmatch / Block / Report / Scam.
// (Spam, Other, Uncrush rows removed.)
type ActionType = 'unmatch' | 'block' | 'report' | 'scam';

// P2-6: Reasons reconciled with backend `users.reportUser` literal union
// (fake_profile | inappropriate_photos | harassment | spam | underage | other).
// "Spam" and "Other" were missing from the UI; "Other" requires a free-text
// description so moderators can act on it.
type ReportReasonId =
  | 'fake_profile'
  | 'inappropriate_photos'
  | 'harassment'
  | 'spam'
  | 'underage'
  | 'other';

const REPORT_REASONS: ReadonlyArray<{
  id: ReportReasonId;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  { id: 'fake_profile', label: 'Fake profile', icon: 'person-remove-outline' },
  { id: 'inappropriate_photos', label: 'Inappropriate photos', icon: 'warning-outline' },
  { id: 'harassment', label: 'Harassment', icon: 'hand-left-outline' },
  { id: 'spam', label: 'Spam', icon: 'mail-unread-outline' },
  { id: 'underage', label: 'Underage', icon: 'alert-circle-outline' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

// P2-6: 'other_description' captures a free-text description from the user
// before submitting `reason: 'other'` to the backend. Backend caps the field
// at 500 chars.
type ViewState = 'main' | 'report' | 'other_description';
const OTHER_DESCRIPTION_MIN = 5;
const OTHER_DESCRIPTION_MAX = 500;

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
  source = 'unknown',
  conversationId,
  matchId,
  onBlockSuccess,
  onUnmatchSuccess,
  onReportSuccess,
}: Props) {
  const [viewState, setViewState] = useState<ViewState>('main');
  // P2-6: Free-text description for `reason: 'other'`. Cleared on reset.
  const [otherDescription, setOtherDescription] = useState('');
  // P2-3: Single in-flight guard for all destructive actions so the modal
  // doesn't fire the same mutation twice from a fast double-tap.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const token = useAuthStore((s) => s.token);
  // P1-3: backend now requires (token, authUserId) for blockUser/reportUser.
  const authUserId = useAuthStore((s) => s.userId);
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
    setOtherDescription('');
    setIsSubmitting(false);
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
            if (!matchId || !token) {
              Alert.alert("Error", "Cannot unmatch: match information not available.");
              return;
            }

            try {
              await unmatchMutation({
                matchId: asMatchId(matchId),
                token,
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
    if (isSubmitting) return;
    logAction('block');
    if (isDemoMode) {
      useDemoStore.getState().blockUser(reportedUserId);
      resetAndClose();
      Toast.show(`${reportedUserName} blocked`);
      onBlockSuccess?.();
      return;
    }

    try {
      if (!token || !authUserId) {
        Alert.alert("Error", "Session expired. Please sign in again.");
        return;
      }
      setIsSubmitting(true);
      // P2-3: blockUser now returns a discriminated result; surface the
      // failure reason instead of pretending the action succeeded.
      const result = await blockMutation({
        token,
        authUserId,
        blockedUserId: asUserId(reportedUserId),
      });
      if (result?.success === false) {
        setIsSubmitting(false);
        if (result.error === 'cannot_block_self') {
          Alert.alert("Can't block", "You can't block your own account.");
          return;
        }
        if (result.error === 'unauthorized') {
          Alert.alert("Error", "Session expired. Please sign in again.");
          return;
        }
        if (result.error === 'rate_limited') {
          Toast.show(formatRateLimitMessage(result.retryAfterMs));
          return;
        }
        Alert.alert("Error", "Failed to block user.");
        return;
      }
      resetAndClose();
      Toast.show(`${reportedUserName} blocked`);
      onBlockSuccess?.();
    } catch (error: unknown) {
      setIsSubmitting(false);
      Alert.alert("Error", getErrorMessage(error, "Failed to block user."));
    }
  };

  // P2-3 / P2-8: Shared submit path for the picker reasons + Scam quick-action.
  // Inspects the discriminated result from `users.reportUser` and surfaces
  // rate-limit / dedupe / self-report errors honestly instead of showing a
  // bogus success toast.
  const submitReport = async (
    reason: ReportReasonId,
    description: string | undefined,
    successToast: string,
    analyticsAction: ActionType,
  ) => {
    if (isSubmitting) return;
    logAction(analyticsAction, reason);
    if (isDemoMode) {
      Toast.show(successToast);
      resetAndClose();
      onReportSuccess?.();
      return;
    }

    try {
      if (!token || !authUserId) {
        Alert.alert("Error", "Session expired. Please sign in again.");
        return;
      }
      setIsSubmitting(true);
      const result = await reportMutation({
        token,
        authUserId,
        reportedUserId: asUserId(reportedUserId),
        reason,
        description,
        source,
      });

      if (result?.success === false) {
        setIsSubmitting(false);
        if (result.error === 'rate_limited') {
          // P2-3: Surface the actionable retry-after window from the backend.
          Toast.show(formatRateLimitMessage(result.retryAfterMs));
          return;
        }
        if (result.error === 'duplicate_recent_report') {
          Toast.show("You've already reported this user recently.");
          resetAndClose();
          // Treat dedupe as effectively successful for deck-removal purposes
          // so the profile still drops out of view.
          onReportSuccess?.();
          return;
        }
        if (result.error === 'cannot_report_self') {
          Alert.alert("Can't report", "You can't report your own account.");
          return;
        }
        if (result.error === 'description_too_long') {
          Alert.alert("Too long", "Please keep the description under 500 characters.");
          return;
        }
        Alert.alert("Error", "Failed to submit report.");
        return;
      }

      Toast.show(successToast);
      resetAndClose();
      onReportSuccess?.();
    } catch (error: unknown) {
      setIsSubmitting(false);
      Alert.alert("Error", getErrorMessage(error, "Failed to submit report."));
    }
  };

  // P2-6: 'Other' opens the description sub-view instead of submitting
  // immediately. All other reasons submit straight away.
  const handleReportReason = (reason: ReportReasonId) => {
    if (reason === 'other') {
      setViewState('other_description');
      return;
    }
    // P2-8: success toast updated to the friendlier review-acknowledgement copy.
    void submitReport(reason, undefined, "Thanks — we'll review this report.", 'report');
  };

  // P2-6: Submit handler for the 'Other' description sub-view. Requires a
  // minimum description length so moderators have something actionable.
  const handleSubmitOtherDescription = () => {
    const trimmed = otherDescription.trim();
    if (trimmed.length < OTHER_DESCRIPTION_MIN) {
      Alert.alert("Add a bit more", `Please describe the issue (at least ${OTHER_DESCRIPTION_MIN} characters).`);
      return;
    }
    void submitReport('other', trimmed, "Thanks — we'll review this report.", 'report');
  };

  // Scam: frontend-only mapping to backend `other` reason with description.
  // No new backend literal is added — the `reports` audit row just records
  // `reason: 'other'` + description so moderators can see the user-facing label.
  const handleScam = () => {
    void submitReport('other', 'Scam/fraudulent behavior', "Reported as scam", 'scam');
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

  // P2-6: Report reason sub-view — now reconciled with backend reasons
  // (fake_profile, inappropriate_photos, harassment, spam, underage, other).
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
            disabled={isSubmitting}
          >
            <Ionicons name={reason.icon} size={20} color={COLORS.textLight} />
            <Text style={styles.actionText}>{reason.label}</Text>
            {reason.id === 'other' ? (
              <>
                <View style={{ flex: 1 }} />
                <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
              </>
            ) : null}
          </TouchableOpacity>
        </React.Fragment>
      ))}

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // P2-6: 'Other' description sub-view — collects a short free-text
  // description before submitting `reason: 'other'` to the backend.
  const renderOtherDescription = () => {
    const trimmedLength = otherDescription.trim().length;
    const submitDisabled = isSubmitting || trimmedLength < OTHER_DESCRIPTION_MIN;
    return (
      <View style={styles.content}>
        <View style={styles.reportHeader}>
          <TouchableOpacity
            onPress={() => setViewState('report')}
            hitSlop={8}
            disabled={isSubmitting}
          >
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.reportTitle}>Other</Text>
          <View style={{ width: 22 }} />
        </View>

        <Text style={styles.otherHelperText}>
          Briefly describe the issue so our team can review it.
        </Text>
        <TextInput
          style={styles.otherInput}
          value={otherDescription}
          onChangeText={setOtherDescription}
          placeholder="What happened?"
          placeholderTextColor={COLORS.textLight}
          multiline
          maxLength={OTHER_DESCRIPTION_MAX}
          editable={!isSubmitting}
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
          <Text style={styles.submitButtonText}>Submit report</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderActiveView = () => {
    if (viewState === 'other_description') return renderOtherDescription();
    if (viewState === 'report') return renderReportReasons();
    return renderMain();
  };

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
          {renderActiveView()}
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
  // P2-6: 'Other' description sub-view styles.
  otherHelperText: {
    fontSize: 13.5,
    color: COLORS.textLight,
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 19,
  },
  otherInput: {
    minHeight: 96,
    maxHeight: 180,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: COLORS.text,
    textAlignVertical: 'top',
    backgroundColor: COLORS.background,
  },
  otherCounter: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginBottom: 10,
    fontSize: 11.5,
    color: COLORS.textLight,
  },
  submitButton: {
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: COLORS.warning,
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
