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

interface TruthDareInviteCardProps {
  inviterName: string;
  isInvitee: boolean;  // true if current user is the one being invited
  onAccept?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
}

export function TruthDareInviteCard({
  inviterName,
  isInvitee,
  onAccept,
  onReject,
}: TruthDareInviteCardProps) {
  const [isResponding, setIsResponding] = useState(false);

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
      <View style={styles.card}>
        {/* Icon and title */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="wine" size={24} color={COLORS.white} />
          </View>
          <Text style={styles.title}>Truth or Dare</Text>
        </View>

        {/* Message */}
        <Text style={styles.message}>
          {isInvitee
            ? `${inviterName} invited you to play Truth or Dare`
            : 'You sent a game invite'}
        </Text>

        {/* Actions */}
        {isInvitee ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={handleReject}
              disabled={isResponding}
            >
              {isResponding ? (
                <ActivityIndicator size="small" color={COLORS.text} />
              ) : (
                <Text style={styles.rejectButtonText}>Reject</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
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
            <ActivityIndicator size="small" color={COLORS.textLight} />
            <Text style={styles.waitingText}>Waiting for response...</Text>
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
