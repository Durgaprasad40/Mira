import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import * as LocalAuthentication from 'expo-local-authentication';

const C = INCOGNITO_COLORS;

export default function PrivateDataRecoveryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { userId } = useAuthStore();
  const localDeletionStatus = usePrivateProfileStore((s) => s.deletionStatus);
  const localDeletedAt = usePrivateProfileStore((s) => s.deletedAt);
  const localRecoverUntil = usePrivateProfileStore((s) => s.recoverUntil);
  const recoverPrivateData = usePrivateProfileStore((s) => s.recoverPrivateData);
  const initiatePrivateDataDeletion = usePrivateProfileStore((s) => s.initiatePrivateDataDeletion);

  const recoverDeletionMutation = useMutation(api.privateDeletion.recoverPrivateDeletion);

  // Query server deletion state (source of truth in non-demo mode)
  const serverDeletionState = useQuery(
    api.privateDeletion.getPrivateDeletionState,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  const [daysRemaining, setDaysRemaining] = useState(0);
  const [expired, setExpired] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  // B3-MEDIUM FIX: Prevent setState-after-unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Determine effective deletion state (server in non-demo, local in demo)
  const effectiveDeletionStatus = isDemoMode ? localDeletionStatus : (serverDeletionState?.status ?? localDeletionStatus);
  const effectiveDeletedAt = isDemoMode ? localDeletedAt : (serverDeletionState?.deletedAt ?? localDeletedAt);
  const effectiveRecoverUntil = isDemoMode ? localRecoverUntil : (serverDeletionState?.recoverUntil ?? localRecoverUntil);

  // Sync local store with server state if they differ (non-demo mode only)
  useEffect(() => {
    if (isDemoMode || !serverDeletionState) return;

    const serverStatus = serverDeletionState.status;
    const serverRecoverUntil = serverDeletionState.recoverUntil;
    const serverDeletedAt = serverDeletionState.deletedAt;

    // If server says pending_deletion but local doesn't match, sync local to server
    if (serverStatus === 'pending_deletion' && localDeletionStatus !== 'pending_deletion') {
      if (serverDeletedAt && serverRecoverUntil) {
        initiatePrivateDataDeletion();
      }
    }

    // If server says active but local says pending, reset local to active
    if (serverStatus === 'active' && localDeletionStatus === 'pending_deletion') {
      recoverPrivateData();
    }
  }, [serverDeletionState, localDeletionStatus, isDemoMode, initiatePrivateDataDeletion, recoverPrivateData]);

  useEffect(() => {
    if (!effectiveRecoverUntil) {
      setExpired(true);
      return;
    }

    const checkRecoveryWindow = () => {
      const now = Date.now();
      const remaining = effectiveRecoverUntil - now;

      if (remaining <= 0) {
        setExpired(true);
        setDaysRemaining(0);
      } else {
        setExpired(false);
        const days = Math.ceil(remaining / (1000 * 60 * 60 * 24));
        setDaysRemaining(days);
      }
    };

    checkRecoveryWindow();
    const interval = setInterval(checkRecoveryWindow, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [effectiveRecoverUntil]);

  const handleRecover = async () => {
    // M-005 FIX: Prevent multiple simultaneous recovery attempts (double-tap guard)
    if (isRecovering) return;

    if (expired) {
      Alert.alert(
        'Recovery Window Expired',
        'Your private data was permanently deleted. The 30-day recovery period has ended.',
        [{ text: 'OK', onPress: () => router.replace('/(main)/(tabs)/profile' as any) }]
      );
      return;
    }

    // M-005 FIX: Set recovering state before any async work (biometric auth)
    setIsRecovering(true);

    // Step 1: Authenticate user with biometric or device PIN
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();

      if (!hasHardware) {
        Alert.alert(
          'Device Authentication Not Available',
          'This device does not support biometric or device PIN authentication.'
        );
        if (mountedRef.current) setIsRecovering(false);
        return;
      }

      // B3-MEDIUM FIX: Wrap authentication with 30s timeout to prevent infinite hang
      const authPromise = LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to recover your private data',
        fallbackLabel: 'Use device PIN',
        cancelLabel: 'Cancel',
      });

      const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'timeout' }), 30000)
      );

      const authResult = await Promise.race([authPromise, timeoutPromise]);

      // Handle timeout
      if ('error' in authResult && authResult.error === 'timeout') {
        Alert.alert('Authentication Timed Out', 'Authentication timed out. Please try again.');
        if (mountedRef.current) setIsRecovering(false);
        return;
      }

      // If authentication failed or user cancelled, do nothing
      if (!authResult.success) {
        if (mountedRef.current) setIsRecovering(false);
        return;
      }

      // Authentication succeeded, proceed with recovery confirmation
    } catch (error) {
      console.error('Authentication error:', error);
      Alert.alert('Error', 'Device authentication failed. Please try again.');
      if (mountedRef.current) setIsRecovering(false);
      return;
    }

    // Step 2: Show confirmation alert (only if authenticated)
    Alert.alert(
      'Recover Private Data',
      'Your private profile will be restored exactly as it was before deletion.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            if (mountedRef.current) setIsRecovering(false);
          },
        },
        {
          text: 'Recover',
          onPress: async () => {
            // Prevent duplicate calls (double-tap guard)
            if (isRecovering) return;

            try {
              if (mountedRef.current) setIsRecovering(true);

              // CRITICAL: Verify userId exists before proceeding (non-demo mode)
              if (!isDemoMode && !userId) {
                Alert.alert('Error', 'You must be logged in to recover private data.');
                return;
              }

              // Update local store immediately for UI responsiveness
              recoverPrivateData();

              // Call server-side mutation (skip in demo mode)
              if (!isDemoMode && userId) {
                await recoverDeletionMutation({ userId: userId as Id<'users'> });
              }

              Alert.alert(
                'Data Recovered',
                'Your private profile has been restored successfully.',
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace('/(main)/(private)/(tabs)/deep-connect' as any),
                  },
                ]
              );
            } catch (error) {
              console.error('Error recovering data:', error);
              Alert.alert('Error', 'Failed to recover data. Please try again.');
            } finally {
              if (mountedRef.current) setIsRecovering(false);
            }
          },
        },
      ]
    );
  };

  const formatRecoverUntilDate = () => {
    if (!effectiveRecoverUntil) return '';
    const date = new Date(effectiveRecoverUntil);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPermanentDeletionDate = () => {
    if (!effectiveDeletedAt) return '';
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const deletionDate = new Date(effectiveDeletedAt + THIRTY_DAYS_MS);
    return deletionDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(main)/(tabs)/profile' as any)} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Private Data Recovery</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        {/* Loading state for server query (non-demo mode only) */}
        {!isDemoMode && serverDeletionState === undefined ? (
          <>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={[styles.description, { marginTop: 16 }]}>
              Loading deletion status...
            </Text>
          </>
        ) : effectiveDeletionStatus !== 'pending_deletion' ? (
          /* No pending deletion found */
          <>
            <View style={styles.iconContainer}>
              <Ionicons name="information-circle-outline" size={64} color={C.primary} />
            </View>
            <Text style={styles.title}>No pending deletion found</Text>
            <Text style={styles.description}>
              Your private profile is active. There is no pending deletion to recover.
            </Text>
            <TouchableOpacity
              style={styles.recoverButton}
              onPress={() => router.replace('/(main)/(tabs)/profile' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.recoverButtonText}>Back to Profile</Text>
            </TouchableOpacity>
          </>
        ) : (
          /* Normal recovery flow - pending deletion exists */
          <>
            <View style={styles.iconContainer}>
              <Ionicons
                name={expired ? "alert-circle" : "time-outline"}
                size={64}
                color={expired ? "#F44336" : C.primary}
              />
            </View>

            <Text style={styles.title}>
              {expired ? 'Recovery Window Expired' : 'Recover your private data'}
            </Text>

        {!expired && (
          <>
            <Text style={styles.daysText}>
              {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
            </Text>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Recovery deadline:</Text>
              <Text style={styles.infoValue}>{formatRecoverUntilDate()}</Text>
            </View>

            <Text style={styles.description}>
              Your private data is currently hidden. You can recover all your photos, messages, and settings until the deadline above.
            </Text>

            <TouchableOpacity
              style={[styles.recoverButton, isRecovering && styles.recoverButtonDisabled]}
              onPress={handleRecover}
              activeOpacity={0.8}
              disabled={isRecovering}
            >
              {isRecovering ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="refresh-outline" size={20} color="#FFF" />
              )}
              <Text style={styles.recoverButtonText}>
                {isRecovering ? 'Authenticating...' : 'Recover Private Data'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {expired && (
          <>
            <Text style={styles.expiredText}>
              Your private data was permanently deleted on {formatPermanentDeletionDate()}.
            </Text>

            <Text style={styles.expiredDescription}>
              The 30-day recovery window has ended. All private profile data, including photos, messages, and settings, has been permanently removed.
            </Text>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.replace('/(main)/(tabs)/profile' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.backButtonText}>Back to Profile</Text>
            </TouchableOpacity>
          </>
        )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  daysText: {
    fontSize: 48,
    fontWeight: '800',
    color: C.primary,
    marginBottom: 24,
  },
  infoCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 24,
  },
  infoLabel: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  recoverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  recoverButtonDisabled: {
    opacity: 0.6,
  },
  recoverButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  expiredText: {
    fontSize: 16,
    color: C.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  expiredDescription: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  backButton: {
    backgroundColor: C.surface,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
});
