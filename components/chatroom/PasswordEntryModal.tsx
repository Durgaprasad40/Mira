/**
 * Password Entry Modal
 *
 * Modal for entering password to join a locked/password-protected room.
 * Shows room name, password input, and validates against backend.
 *
 * LOCKED-ROOM-FIX: Ensures password validation before room entry.
 * Implements 5-attempt limit with cooldowns:
 *   Stage 1: 3 immediate attempts
 *   Stage 2: 3-min cooldown, then 1 attempt
 *   Stage 3: 2-min cooldown, then 1 final attempt
 *   Stage 4: permanently blocked
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { INCOGNITO_COLORS } from '@/lib/constants';
import * as Haptics from 'expo-haptics';

const C = INCOGNITO_COLORS;

interface PasswordEntryModalProps {
  visible: boolean;
  roomId: string;
  roomName: string;
  authUserId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function PasswordEntryModal({
  visible,
  roomId,
  roomName,
  authUserId,
  onSuccess,
  onCancel,
}: PasswordEntryModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [cooldownMs, setCooldownMs] = useState<number | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [stage, setStage] = useState(1);
  const inputRef = useRef<TextInput>(null);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const joinRoomWithPasswordMut = useMutation(api.chatRooms.joinRoomWithPassword);

  // Query current attempt state when modal opens
  const attemptState = useQuery(
    api.chatRooms.getPasswordAttemptState,
    visible && roomId && authUserId
      ? { roomId: roomId as Id<'chatRooms'>, authUserId }
      : 'skip'
  );

  // Update state when attempt state query loads
  useEffect(() => {
    if (attemptState) {
      setStage(attemptState.stage);
      setAttemptsRemaining(attemptState.attemptsRemaining);
      setIsBlocked(attemptState.blocked);
      if (attemptState.cooldown && attemptState.cooldownRemainingMs) {
        setCooldownMs(attemptState.cooldownRemainingMs);
      } else {
        setCooldownMs(null);
      }
    }
  }, [attemptState]);

  // Cooldown countdown timer
  useEffect(() => {
    // Clear any existing interval
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }

    if (cooldownMs && cooldownMs > 0) {
      cooldownIntervalRef.current = setInterval(() => {
        setCooldownMs((prev) => {
          if (prev === null || prev <= 1000) {
            // Cooldown ended
            if (cooldownIntervalRef.current) {
              clearInterval(cooldownIntervalRef.current);
              cooldownIntervalRef.current = null;
            }
            // Set 1 attempt available after cooldown
            setAttemptsRemaining(1);
            return null;
          }
          return prev - 1000;
        });
      }, 1000);
    }

    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
        cooldownIntervalRef.current = null;
      }
    };
  }, [cooldownMs]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (visible) {
      setPassword('');
      setError(null);
      setIsLoading(false);
      // Focus input after modal opens (unless blocked/cooldown)
      setTimeout(() => {
        if (!isBlocked && !cooldownMs) {
          inputRef.current?.focus();
        }
      }, 100);
    } else {
      // Clear cooldown timer when modal closes
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
        cooldownIntervalRef.current = null;
      }
    }
  }, [visible, isBlocked, cooldownMs]);

  const handleJoin = useCallback(async () => {
    if (!password.trim() || isLoading || isBlocked || cooldownMs) return;

    setError(null);
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await joinRoomWithPasswordMut({
        roomId: roomId as Id<'chatRooms'>,
        password: password.trim(),
        authUserId,
      });

      setIsLoading(false);

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onSuccess();
        return;
      }

      // Handle failure responses
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      if (result.blocked) {
        setIsBlocked(true);
        setAttemptsRemaining(0);
        setError(result.message || 'Maximum attempts reached.');
        return;
      }

      if (result.cooldown && result.cooldownRemainingMs) {
        setCooldownMs(result.cooldownRemainingMs);
        setAttemptsRemaining(0);
        setError(result.message || 'Too many attempts. Please wait.');
        return;
      }

      // Wrong password with attempts remaining
      if (result.attemptsRemaining !== undefined) {
        setAttemptsRemaining(result.attemptsRemaining);
        setStage(result.stage || stage);
      }
      setError(result.message || 'Incorrect password');
      setPassword('');
    } catch (err: any) {
      setIsLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // Map error messages to user-friendly text
      const message = err.message || 'Failed to join room';
      if (message.includes('Room not found')) {
        setError('This room is no longer available.');
      } else if (message.includes('expired')) {
        setError('This room has expired.');
      } else if (message.includes('banned')) {
        setError('You are not allowed to join this room.');
      } else {
        // PRIVATE-ROOM-ACCESS-FIX: Removed invite code reference - password-only flow
        setError(message);
      }
    }
  }, [password, isLoading, isBlocked, cooldownMs, roomId, authUserId, joinRoomWithPasswordMut, onSuccess, stage]);

  const handleCancel = useCallback(() => {
    if (isLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  }, [isLoading, onCancel]);

  const toggleShowPassword = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  // Format cooldown time
  const formatCooldown = (ms: number) => {
    const totalSecs = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Get status message
  const getStatusMessage = () => {
    if (isBlocked) {
      return null; // Error message shown separately
    }
    if (cooldownMs && cooldownMs > 0) {
      return `Try again in ${formatCooldown(cooldownMs)}`;
    }
    if (stage === 2 || stage === 3) {
      return stage === 3 ? 'Last attempt remaining' : 'One more attempt available';
    }
    if (attemptsRemaining !== null && attemptsRemaining > 0) {
      return `Attempts remaining: ${attemptsRemaining}`;
    }
    return null;
  };

  const statusMessage = getStatusMessage();
  const isInputDisabled = isBlocked || (cooldownMs !== null && cooldownMs > 0) || isLoading;
  const isJoinDisabled = !password.trim() || isInputDisabled;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />

        <View style={styles.container}>
          {/* Header with lock icon */}
          <View style={styles.header}>
            <View style={[styles.lockIconContainer, isBlocked && styles.lockIconBlocked]}>
              <Ionicons
                name={isBlocked ? 'lock-closed' : 'lock-open-outline'}
                size={28}
                color={isBlocked ? '#EF4444' : '#A78BFA'}
              />
            </View>
            <Text style={styles.title}>
              {isBlocked ? 'Access Denied' : 'Enter Room Password'}
            </Text>
            <Text style={styles.roomName} numberOfLines={1}>
              {roomName || 'Private Room'}
            </Text>
          </View>

          {/* Status message */}
          {statusMessage && !isBlocked && (
            <View style={[styles.statusContainer, cooldownMs ? styles.statusCooldown : undefined]}>
              {cooldownMs ? (
                <Ionicons name="time-outline" size={16} color="#F59E0B" />
              ) : (
                <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.6)" />
              )}
              <Text style={[styles.statusText, cooldownMs ? styles.statusTextCooldown : undefined]}>
                {statusMessage}
              </Text>
            </View>
          )}

          {/* Blocked message */}
          {isBlocked && (
            <View style={styles.blockedContainer}>
              <Text style={styles.blockedText}>
                You have reached the maximum number of attempts for this room.
              </Text>
            </View>
          )}

          {/* Password input (hidden when blocked) */}
          {!isBlocked && (
            <View style={[styles.inputContainer, isInputDisabled && styles.inputContainerDisabled]}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (error) setError(null);
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="join"
                onSubmitEditing={handleJoin}
                editable={!isInputDisabled}
              />
              <TouchableOpacity
                style={styles.togglePasswordButton}
                onPress={toggleShowPassword}
                activeOpacity={0.7}
                disabled={isInputDisabled}
              >
                <Ionicons
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={isInputDisabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)'}
                />
              </TouchableOpacity>
            </View>
          )}

          {/* Error message */}
          {error && !isBlocked && (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <Text style={styles.cancelButtonText}>
                {isBlocked ? 'Close' : 'Cancel'}
              </Text>
            </TouchableOpacity>

            {!isBlocked && (
              <TouchableOpacity
                style={[styles.joinButton, isJoinDisabled && styles.joinButtonDisabled]}
                onPress={handleJoin}
                activeOpacity={0.7}
                disabled={isJoinDisabled}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.joinButtonText}>Join</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  container: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: '#1A1A22',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.2)',
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 10,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  lockIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.25)',
  },
  lockIconBlocked: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  roomName: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
    maxWidth: '90%',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
  },
  statusCooldown: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  statusText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    flex: 1,
  },
  statusTextCooldown: {
    color: '#F59E0B',
    fontWeight: '500',
  },
  blockedContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  blockedText: {
    fontSize: 14,
    color: '#F87171',
    textAlign: 'center',
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F0F14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 12,
  },
  inputContainerDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    height: 50,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#FFFFFF',
  },
  togglePasswordButton: {
    padding: 12,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    flex: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  joinButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
