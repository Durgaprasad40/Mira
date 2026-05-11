/**
 * Background Crossed Paths — Explainer modal (Phase-3)
 *
 * Strict contract:
 *   - When the client-side feature gate is ON (current default), the
 *     "continue" button hands off to
 *     `useBackgroundLocation.enableBackgroundCrossedPaths()`, which
 *     orchestrates: foreground permission → server consent → background
 *     permission → platform-specific server flag → start task. The flow
 *     fail-closes and rolls back on any step failure.
 *   - When the gate is OFF (kill switch), this screen falls back to a
 *     purely informational mode: the "continue" button only dismisses; it
 *     NEVER calls a consent mutation, NEVER asks for any OS permission, and
 *     NEVER starts a TaskManager task.
 *   - This screen ITSELF never directly calls Location APIs or
 *     TaskManager; all OS-touching code lives in the hook.
 *
 * Reached from: Nearby Settings → "Allow background".
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';
import {
  BG_COPY,
  BG_CROSSED_PATHS_FEATURE_READY,
} from '@/lib/backgroundCrossedPaths';
import { useBackgroundLocation } from '@/hooks/useBackgroundLocation';

export default function BackgroundCrossedPathsExplainerScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const { enableBackgroundCrossedPaths } = useBackgroundLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    if (router.canGoBack()) router.back();
  }, [isSubmitting, router]);

  const handleContinue = useCallback(async () => {
    if (isSubmitting) return;

    // Gate-OFF path (current default): purely informational. We DO NOT call
    // any consent mutation, DO NOT ask for any OS permission, and DO NOT
    // touch the TaskManager. The button only dismisses the modal.
    if (!BG_CROSSED_PATHS_FEATURE_READY) {
      if (router.canGoBack()) router.back();
      return;
    }

    // Gate-ON path: hand off to the orchestrator hook. The hook itself
    // re-checks the gate, requests permissions, records consent, sets the
    // platform server flag, and starts the OS task — fail-closing on any
    // step.
    if (isDemoMode || !userId) {
      Toast.show('Consent saved');
      if (router.canGoBack()) router.back();
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await enableBackgroundCrossedPaths();
      if (result.ok) {
        Toast.show('Background detection enabled');
        if (router.canGoBack()) router.back();
      } else {
        // Map structured failure reasons to user-facing toasts.
        switch (result.reason) {
          case 'feature_not_ready':
            Toast.show('This feature is not available yet.');
            break;
          case 'foreground_permission_denied':
            Toast.show('Allow location access to continue.');
            break;
          case 'background_permission_denied':
            Toast.show('Allow background location in Settings to continue.');
            break;
          case 'consent_failed':
            if ((result.message || '').includes('foreground_consent_required')) {
              Toast.show('Turn on Nearby first to use background detection.');
            } else if ((result.message || '').includes('feature_flag_off')) {
              Toast.show('This feature is not available yet.');
            } else {
              Toast.show('Could not save consent. Please try again.');
            }
            break;
          case 'platform_setup_failed':
            Toast.show('Could not enable background mode. Please try again.');
            break;
          case 'task_start_failed':
            Toast.show('Could not start background updates. Please try again.');
            break;
          case 'demo_mode':
          case 'not_authenticated':
          default:
            Toast.show('Could not enable background detection.');
            break;
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, userId, enableBackgroundCrossedPaths, router]);

  // Pick copy variants based on the client-side gate.
  const continueLabel = BG_CROSSED_PATHS_FEATURE_READY
    ? BG_COPY.explainerContinueReady
    : BG_COPY.explainerContinueUnavailable;
  const noticeText = BG_CROSSED_PATHS_FEATURE_READY
    ? BG_COPY.explainerNoticeReady
    : BG_COPY.explainerNoticeUnavailable;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{BG_COPY.explainerTitle}</Text>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
          disabled={isSubmitting}
        >
          <Ionicons name="close" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroIconWrap}>
          <Ionicons name="walk-outline" size={36} color={COLORS.primary} />
        </View>

        <Text style={styles.lead}>{BG_COPY.explainerLead}</Text>

        <View style={styles.bullets}>
          {BG_COPY.explainerBullets.map((line) => (
            <View style={styles.bulletRow} key={line}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.noticeBox}>
          <Ionicons
            name="information-circle"
            size={18}
            color={COLORS.primary}
          />
          <Text style={styles.noticeText}>{noticeText}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={handleClose}
          disabled={isSubmitting}
          accessibilityLabel={BG_COPY.explainerCancel}
        >
          <Text style={styles.btnSecondaryText}>{BG_COPY.explainerCancel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.btn,
            styles.btnPrimary,
            isSubmitting && styles.btnDisabled,
          ]}
          onPress={handleContinue}
          disabled={isSubmitting}
          accessibilityLabel={continueLabel}
        >
          <Text style={styles.btnPrimaryText}>{continueLabel}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  heroIconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  lead: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
    marginBottom: 18,
    textAlign: 'left',
  },
  bullets: {
    marginBottom: 18,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    gap: 12,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primarySubtle,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.text,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondary: {
    backgroundColor: COLORS.backgroundDark,
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
  },
  btnPrimaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
