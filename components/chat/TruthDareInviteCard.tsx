/**
 * TruthDareInviteCard - Chat message card for T/D game invites
 *
 * Shows Accept/Reject buttons for the invitee.
 * Shows "Waiting..." for the inviter.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// PHASE-2 PREMIUM (T/D): dark-glass / midnight-plum palette consumed only when
// the parent passes theme="phase2". Phase-1 callers leave the prop unset so all
// overlays evaluate to null and the original COLORS-based styles render
// byte-identically. Mirrors the palette used in MessageBubble / chats/[id].tsx
// for cohesive cross-component theming.
const PHASE2_TD_INVITE = {
  cardBg: '#22223A',
  cardBorder: 'rgba(233, 69, 96, 0.32)',
  cardGlow: '#E94560',
  iconBg: '#E94560',
  titleText: '#F2F3F8',
  messageText: 'rgba(224, 224, 232, 0.78)',
  acceptBg: '#E94560',
  rejectBg: 'rgba(255, 255, 255, 0.06)',
  rejectBorder: 'rgba(255, 255, 255, 0.14)',
  rejectText: '#F2F3F8',
  waitingText: 'rgba(224, 224, 232, 0.68)',
} as const;

interface TruthDareInviteCardProps {
  inviterName: string;
  isInvitee: boolean;  // true if current user is the one being invited
  onAccept?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  /**
   * PHASE-2 PREMIUM (T/D): visual theme. Defaults to 'phase1' so all existing
   * Phase-1 call sites (ChatScreenInner.tsx) keep their byte-identical look.
   * Phase-2 chats/[id].tsx passes 'phase2' to opt-in to the dark/glass/rose
   * styling that matches the rest of the Phase-2 Messages experience.
   */
  theme?: 'phase1' | 'phase2';
}

export function TruthDareInviteCard({
  inviterName,
  isInvitee,
  onAccept,
  onReject,
  theme = 'phase1',
}: TruthDareInviteCardProps) {
  const [isResponding, setIsResponding] = useState(false);
  const isPhase2 = theme === 'phase2';

  // PHASE-2 PREMIUM (T/D): style overlays appended to existing arrays. Each
  // resolves to `null` when theme === 'phase1', so Phase-1 visuals stay
  // identical (RN ignores null/undefined entries in style arrays).
  const cardOverlay = isPhase2
    ? {
        backgroundColor: PHASE2_TD_INVITE.cardBg,
        borderColor: PHASE2_TD_INVITE.cardBorder,
        shadowColor: PHASE2_TD_INVITE.cardGlow,
        shadowOpacity: 0.28,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
      }
    : null;
  const iconOverlay = isPhase2 ? { backgroundColor: PHASE2_TD_INVITE.iconBg } : null;
  const titleOverlay = isPhase2 ? { color: PHASE2_TD_INVITE.titleText } : null;
  const messageOverlay = isPhase2 ? { color: PHASE2_TD_INVITE.messageText } : null;
  const rejectOverlay = isPhase2
    ? {
        backgroundColor: PHASE2_TD_INVITE.rejectBg,
        borderColor: PHASE2_TD_INVITE.rejectBorder,
      }
    : null;
  const rejectTextOverlay = isPhase2 ? { color: PHASE2_TD_INVITE.rejectText } : null;
  const acceptOverlay = isPhase2 ? { backgroundColor: PHASE2_TD_INVITE.acceptBg } : null;
  const waitingTextOverlay = isPhase2 ? { color: PHASE2_TD_INVITE.waitingText } : null;
  const indicatorRejectColor = isPhase2 ? PHASE2_TD_INVITE.rejectText : COLORS.text;
  const indicatorWaitColor = isPhase2 ? PHASE2_TD_INVITE.waitingText : COLORS.textLight;

  const handleAccept = async () => {
    if (isResponding) return;
    setIsResponding(true);
    try {
      await onAccept?.();
    } finally {
      setIsResponding(false);
    }
  };

  const handleReject = async () => {
    if (isResponding) return;
    setIsResponding(true);
    try {
      await onReject?.();
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.card, cardOverlay]}>
        {/* Icon and title */}
        <View style={styles.header}>
          <View style={[styles.iconContainer, iconOverlay]}>
            <Ionicons name="wine" size={24} color={COLORS.white} />
          </View>
          <Text style={[styles.title, titleOverlay]}>Truth or Dare</Text>
        </View>

        {/* Message */}
        <Text style={[styles.message, messageOverlay]}>
          {isInvitee
            ? `${inviterName} invited you to play Truth or Dare`
            : 'You sent a game invite'}
        </Text>

        {/* Actions */}
        {isInvitee ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton, rejectOverlay]}
              onPress={handleReject}
              disabled={isResponding}
            >
              {isResponding ? (
                <ActivityIndicator size="small" color={indicatorRejectColor} />
              ) : (
                <Text style={[styles.rejectButtonText, rejectTextOverlay]}>Reject</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.acceptButton, acceptOverlay]}
              onPress={handleAccept}
              disabled={isResponding}
            >
              {isResponding ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.acceptButtonText}>Accept</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.waitingContainer}>
            <ActivityIndicator size="small" color={indicatorWaitColor} />
            <Text style={[styles.waitingText, waitingTextOverlay]}>Waiting for response...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  card: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 16,
    width: '90%',
    maxWidth: 300,
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  message: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  acceptButton: {
    backgroundColor: COLORS.primary,
  },
  rejectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  waitingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  waitingText: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
});
