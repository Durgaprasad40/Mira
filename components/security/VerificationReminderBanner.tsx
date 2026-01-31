import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/lib/constants";
import type { EnforcementLevel } from "@/lib/securityEnforcement";
import { getEnforcementMessage } from "@/lib/securityEnforcement";

interface Props {
  level: EnforcementLevel;
  onDismiss: () => void;
  onVerify: () => void;
}

export function VerificationReminderBanner({
  level,
  onDismiss,
  onVerify,
}: Props) {
  if (level === "none" || level === "security_only") return null;

  const message = getEnforcementMessage(level);
  if (!message) return null;

  const isGentleReminder = level === "gentle_reminder";
  const backgroundColor = isGentleReminder ? "#E3F2FD" : "#FFF3E0";
  const textColor = isGentleReminder ? "#1565C0" : "#E65100";
  const iconName = isGentleReminder
    ? "information-circle"
    : "warning";

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.content}>
        <Ionicons name={iconName} size={20} color={textColor} />
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: textColor }]}>
            {message.title}
          </Text>
          <Text style={[styles.body, { color: textColor + "CC" }]}>
            {message.body}
          </Text>
        </View>
        {isGentleReminder && (
          <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn}>
            <Ionicons name="close" size={18} color={textColor} />
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={[styles.ctaButton, { backgroundColor: textColor }]}
        onPress={onVerify}
      >
        <Text style={styles.ctaText}>{message.ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    padding: 12,
  },
  content: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  dismissBtn: {
    padding: 2,
  },
  ctaButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  ctaText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "700",
  },
});
