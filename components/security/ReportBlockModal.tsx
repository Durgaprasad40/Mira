import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";

type ReportReason =
  | "fake_profile"
  | "inappropriate_photos"
  | "harassment"
  | "spam"
  | "underage"
  | "other";

const REPORT_REASONS: { value: ReportReason; label: string; icon: string }[] = [
  { value: "fake_profile", label: "Fake Profile", icon: "person-remove" },
  {
    value: "inappropriate_photos",
    label: "Inappropriate Photos",
    icon: "image-outline",
  },
  { value: "harassment", label: "Harassment", icon: "hand-left-outline" },
  { value: "spam", label: "Spam", icon: "megaphone-outline" },
  { value: "underage", label: "Underage", icon: "alert-circle-outline" },
  { value: "other", label: "Other", icon: "ellipsis-horizontal" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  currentUserId: string;
  onBlockSuccess?: () => void;
}

export function ReportBlockModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  currentUserId,
  onBlockSuccess,
}: Props) {
  const [step, setStep] = useState<"main" | "report" | "confirm">("main");
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(
    null
  );
  const [otherDescription, setOtherDescription] = useState("");

  const blockMutation = useMutation(api.users.blockUser);
  const reportMutation = useMutation(api.users.reportUser);

  const handleBlock = async () => {
    if (isDemoMode) {
      Alert.alert(
        "Blocked",
        `${reportedUserName} has been blocked. They won't see your profile or message you.`
      );
      resetAndClose();
      onBlockSuccess?.();
      return;
    }

    try {
      await blockMutation({
        blockerId: currentUserId as any,
        blockedUserId: reportedUserId as any,
      });
      Alert.alert(
        "Blocked",
        `${reportedUserName} has been blocked. They won't see your profile or message you.`
      );
      resetAndClose();
      onBlockSuccess?.();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to block user.");
    }
  };

  const handleReport = async () => {
    if (!selectedReason) return;

    if (isDemoMode) {
      setStep("confirm");
      return;
    }

    try {
      await reportMutation({
        reporterId: currentUserId as any,
        reportedUserId: reportedUserId as any,
        reason: selectedReason,
        description:
          selectedReason === "other" ? otherDescription : undefined,
      });

      // Auto-block after report
      await blockMutation({
        blockerId: currentUserId as any,
        blockedUserId: reportedUserId as any,
      });

      setStep("confirm");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit report.");
    }
  };

  const resetAndClose = () => {
    setStep("main");
    setSelectedReason(null);
    setOtherDescription("");
    onClose();
  };

  const renderMain = () => (
    <View style={styles.content}>
      <Text style={styles.title}>
        {reportedUserName}
      </Text>

      <TouchableOpacity style={styles.blockButton} onPress={handleBlock}>
        <Ionicons name="ban" size={22} color={COLORS.error} />
        <View style={styles.optionTextContainer}>
          <Text style={styles.blockText}>Block</Text>
          <Text style={styles.blockSubtext}>
            They won't see your profile or message you
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={styles.reportButton}
        onPress={() => setStep("report")}
      >
        <Ionicons name="flag" size={22} color={COLORS.warning} />
        <View style={styles.optionTextContainer}>
          <Text style={styles.reportText}>Report</Text>
          <Text style={styles.reportSubtext}>
            Flag inappropriate behavior
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderReport = () => (
    <ScrollView style={styles.content}>
      <Text style={styles.title}>Report {reportedUserName}</Text>
      <Text style={styles.subtitle}>
        Select a reason for your report
      </Text>

      {REPORT_REASONS.map((reason) => (
        <TouchableOpacity
          key={reason.value}
          style={[
            styles.reasonOption,
            selectedReason === reason.value && styles.reasonSelected,
          ]}
          onPress={() => setSelectedReason(reason.value)}
        >
          <Ionicons
            name={reason.icon as any}
            size={20}
            color={
              selectedReason === reason.value
                ? COLORS.primary
                : COLORS.textLight
            }
          />
          <Text
            style={[
              styles.reasonText,
              selectedReason === reason.value && styles.reasonTextSelected,
            ]}
          >
            {reason.label}
          </Text>
          {selectedReason === reason.value && (
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={COLORS.primary}
            />
          )}
        </TouchableOpacity>
      ))}

      {selectedReason === "other" && (
        <TextInput
          style={styles.descriptionInput}
          placeholder="Please describe the issue..."
          placeholderTextColor={COLORS.textMuted}
          value={otherDescription}
          onChangeText={setOtherDescription}
          multiline
          maxLength={500}
        />
      )}

      <TouchableOpacity
        style={[
          styles.submitButton,
          !selectedReason && styles.submitDisabled,
        ]}
        onPress={handleReport}
        disabled={!selectedReason}
      >
        <Text style={styles.submitText}>Submit Report</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => setStep("main")}
      >
        <Text style={styles.cancelText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderConfirm = () => (
    <View style={styles.content}>
      <View style={styles.confirmIcon}>
        <Ionicons
          name="checkmark-circle"
          size={64}
          color={COLORS.success}
        />
      </View>
      <Text style={styles.confirmTitle}>Thank you</Text>
      <Text style={styles.confirmSubtitle}>
        Thank you for helping keep Mira safe. We'll review this report.
      </Text>
      <TouchableOpacity
        style={styles.submitButton}
        onPress={() => {
          resetAndClose();
          onBlockSuccess?.();
        }}
      >
        <Text style={styles.submitText}>Done</Text>
      </TouchableOpacity>
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
          {step === "main" && renderMain()}
          {step === "report" && renderReport()}
          {step === "confirm" && renderConfirm()}
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
    maxHeight: "80%",
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
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: "center",
    marginBottom: 20,
  },
  blockButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.error + "10",
    gap: 14,
  },
  optionTextContainer: {
    flex: 1,
  },
  blockText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.error,
  },
  blockSubtext: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 12,
  },
  reportButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.warning + "10",
    gap: 14,
  },
  reportText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.warning,
  },
  reportSubtext: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
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
  reasonOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
    gap: 12,
  },
  reasonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + "08",
  },
  reasonText: {
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },
  reasonTextSelected: {
    fontWeight: "600",
    color: COLORS.primary,
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
    marginTop: 8,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 12,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  confirmIcon: {
    alignItems: "center",
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 8,
  },
  confirmSubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: "center",
    lineHeight: 22,
  },
});
