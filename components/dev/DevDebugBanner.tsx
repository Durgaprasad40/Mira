import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useDemoStore } from "@/stores/demoStore";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";

// =============================================================================
// Ring Buffer for Console Logs
// =============================================================================

const MAX_LOGS = 20;
const logBuffer: Array<{ type: string; message: string; timestamp: number }> = [];

// Capture console logs in DEV mode
if (__DEV__) {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  const captureLog = (type: string, ...args: any[]) => {
    const message = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
      )
      .join(" ");

    logBuffer.push({
      type,
      message: message.substring(0, 200), // Truncate long messages
      timestamp: Date.now(),
    });

    // Keep only last MAX_LOGS
    while (logBuffer.length > MAX_LOGS) {
      logBuffer.shift();
    }
  };

  console.log = (...args) => {
    captureLog("LOG", ...args);
    originalConsole.log(...args);
  };

  console.warn = (...args) => {
    captureLog("WARN", ...args);
    originalConsole.warn(...args);
  };

  console.error = (...args) => {
    captureLog("ERROR", ...args);
    originalConsole.error(...args);
  };
}

// =============================================================================
// Debug Info
// =============================================================================

const DEBUG_DISABLE_MAP = true; // Mirror the flag from nearby.tsx

const getDebugInfo = () => ({
  platform: Platform.OS,
  demoMode: process.env.EXPO_PUBLIC_DEMO_MODE === "true",
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL || "not set",
  mapsDisabled: DEBUG_DISABLE_MAP,
  bundlerUrl: Constants.expoConfig?.hostUri || "unknown",
  appVersion: Constants.expoConfig?.version || "unknown",
  sdkVersion: Constants.expoConfig?.sdkVersion || "unknown",
});

// =============================================================================
// Component
// =============================================================================

interface DevDebugBannerProps {
  /** If true, starts expanded */
  defaultExpanded?: boolean;
}

export function DevDebugBanner({ defaultExpanded = false }: DevDebugBannerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [logs, setLogs] = useState(logBuffer);
  const [info] = useState(getDebugInfo);
  const router = useRouter();

  // Store hooks for reset functionality
  const resetOnboardingStore = useOnboardingStore((s) => s.reset);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const logout = useAuthStore((s) => s.logout);

  // Refresh logs periodically when expanded
  useEffect(() => {
    if (!expanded) return;
    const interval = setInterval(() => {
      setLogs([...logBuffer]);
    }, 1000);
    return () => clearInterval(interval);
  }, [expanded]);

  // Only render in DEV mode
  if (!__DEV__) return null;

  const toggleExpanded = useCallback(() => setExpanded((e) => !e), []);

  /**
   * Reset local session for testing onboarding flow.
   * Only available in DEV mode with DEMO enabled.
   */
  const handleResetOnboarding = useCallback(() => {
    // Safety: only allow in development builds with demo mode
    if (!__DEV__) return;
    if (!isDemoMode) return;

    Alert.alert(
      "Reset Local Session",
      "This will log you out and restart onboarding from the beginning. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            try {
              // 1. Clear auth state (token, userId, onboardingCompleted)
              logout();

              // 2. Reset onboarding store to initial state
              resetOnboardingStore();

              // 3. Clear demo onboarding complete flag for current user
              if (currentDemoUserId) {
                useDemoStore.setState((state) => ({
                  demoOnboardingComplete: {
                    ...state.demoOnboardingComplete,
                    [currentDemoUserId]: false,
                  },
                }));
              }

              // 4. Clear current demo user to force fresh login
              useDemoStore.setState({ currentDemoUserId: null });

              console.log("[DevDebugBanner] Local session reset complete");

              // 5. Navigate to welcome/auth screen
              router.replace("/(auth)/welcome");
            } catch (error) {
              console.error("[DevDebugBanner] Reset failed:", error);
              Alert.alert("Error", "Failed to reset session. See console for details.");
            }
          },
        },
      ]
    );
  }, [logout, resetOnboardingStore, currentDemoUserId, router]);

  return (
    <View style={styles.container}>
      {/* Collapsed banner */}
      <Pressable style={styles.banner} onPress={toggleExpanded}>
        <Text style={styles.bannerText}>
          DEV {info.demoMode ? "DEMO" : "LIVE"} | Maps:{" "}
          {info.mapsDisabled ? "OFF" : "ON"} | {info.platform.toUpperCase()}
        </Text>
        <Text style={styles.expandIcon}>{expanded ? "▼" : "▲"}</Text>
      </Pressable>

      {/* Expanded panel */}
      {expanded && (
        <View style={styles.panel}>
          {/* Info section */}
          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>Connection Info</Text>
            <Text style={styles.infoText}>Bundler: {info.bundlerUrl}</Text>
            <Text style={styles.infoText}>Convex: {info.convexUrl}</Text>
            <Text style={styles.infoText}>
              Demo Mode: {info.demoMode ? "YES" : "NO"}
            </Text>
            <Text style={styles.infoText}>
              Maps Disabled: {info.mapsDisabled ? "YES" : "NO"}
            </Text>
            <Text style={styles.infoText}>
              App: v{info.appVersion} (SDK {info.sdkVersion})
            </Text>

            {/* Reset Onboarding Button - only in dev builds with demo mode */}
            {__DEV__ && isDemoMode && (
              <Pressable style={styles.resetButton} onPress={handleResetOnboarding}>
                <Text style={styles.resetButtonText}>🔄 Reset Local Session</Text>
              </Pressable>
            )}
          </View>

          {/* Logs section */}
          <View style={styles.logsSection}>
            <Text style={styles.infoTitle}>
              Recent Logs ({logs.length}/{MAX_LOGS})
            </Text>
            <ScrollView style={styles.logsScroll} nestedScrollEnabled>
              {logs.length === 0 ? (
                <Text style={styles.logText}>No logs captured yet</Text>
              ) : (
                logs
                  .slice()
                  .reverse()
                  .map((log, i) => (
                    <Text
                      key={i}
                      style={[
                        styles.logText,
                        log.type === "ERROR" && styles.logError,
                        log.type === "WARN" && styles.logWarn,
                      ]}
                      numberOfLines={2}
                    >
                      [{log.type}] {log.message}
                    </Text>
                  ))
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  banner: {
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bannerText: {
    color: "#0f0",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
  },
  expandIcon: {
    color: "#0f0",
    fontSize: 10,
  },
  panel: {
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    paddingHorizontal: 12,
    paddingBottom: 12,
    maxHeight: 300,
  },
  infoSection: {
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    paddingBottom: 8,
    marginBottom: 8,
  },
  infoTitle: {
    color: "#0ff",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  infoText: {
    color: "#ccc",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 2,
  },
  logsSection: {
    flex: 1,
  },
  logsScroll: {
    maxHeight: 150,
  },
  logText: {
    color: "#aaa",
    fontSize: 9,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 2,
  },
  logError: {
    color: "#f55",
  },
  logWarn: {
    color: "#fa0",
  },
  testButton: {
    backgroundColor: "#0a0",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  testButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  resetButton: {
    backgroundColor: "#c40",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  resetButtonText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});

export default DevDebugBanner;
