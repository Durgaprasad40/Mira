import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useDemoDmStore } from "@/stores/demoDmStore";

export default function TutorialScreen() {
  const router = useRouter();
  const { reset } = useOnboardingStore();
  const { setOnboardingCompleted } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: "Swipe Right to Like",
      description: "Swipe right or tap the heart to like someone",
      icon: "heart",
      color: COLORS.like,
      gesture: "right",
    },
    {
      title: "Swipe Left to Pass",
      description: "Swipe left or tap the X to pass on someone",
      icon: "close",
      color: COLORS.pass,
      gesture: "left",
    },
    {
      title: "Swipe Up for Super Like",
      description: "Swipe up or tap the star to super like someone",
      icon: "star",
      color: COLORS.superLike,
      gesture: "up",
    },
    {
      title: "Tap to See More",
      description: "Tap on a profile card to see full details and photos",
      icon: "expand",
      color: COLORS.primary,
      gesture: "tap",
    },
  ];

  const handleComplete = () => {
    // OB-4 fix: Mark onboarding complete ONLY here (after tutorial is finished)
    // This ensures user sees the tutorial before being marked complete
    setOnboardingCompleted(true);
    reset();
    if (isDemoMode) {
      // OB-4: Mark demo onboarding complete (moved from review.tsx)
      const userId = useAuthStore.getState().userId;
      if (userId) {
        useDemoStore.getState().setDemoOnboardingComplete(userId);
      }
      // OB-8 fix: Only clear DM data if store is empty (fresh onboarding)
      // This prevents data loss if user somehow re-enters onboarding/tutorial
      const dmState = useDemoDmStore.getState();
      const hasExistingData = Object.keys(dmState.conversations).length > 0;
      if (!hasExistingData) {
        useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
      }
      // Seed demo profiles/matches/likes
      useDemoStore.getState().seed();
    }
    router.replace("/(main)/(tabs)/home");
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  // Get gesture helper text for current step
  const getGestureText = () => {
    switch (steps[currentStep].gesture) {
      case "right": return "Swipe Right →";
      case "left": return "← Swipe Left";
      case "up": return "↑ Swipe Up";
      case "tap": return "Tap to View";
      default: return "";
    }
  };

  // Get arrow icon for current step
  const getArrowIcon = () => {
    switch (steps[currentStep].gesture) {
      case "right": return "arrow-forward";
      case "left": return "arrow-back";
      case "up": return "arrow-up";
      case "tap": return "hand-left";
      default: return "arrow-forward";
    }
  };

  return (
    <LinearGradient
      colors={[COLORS.primary, COLORS.secondary]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Content area - centered */}
        <View style={styles.content}>
          {/* Icon with high contrast background */}
          <View style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Ionicons
                name={steps[currentStep].icon as any}
                size={56}
                color={COLORS.white}
              />
            </View>
          </View>

          <Text style={styles.title}>{steps[currentStep].title}</Text>
          <Text style={styles.description}>
            {steps[currentStep].description}
          </Text>

          {/* Gesture demo card */}
          <View style={styles.gestureDemo}>
            <View style={styles.card}>
              <Ionicons
                name={getArrowIcon() as any}
                size={28}
                color={steps[currentStep].color}
              />
            </View>
          </View>
        </View>

        {/* Footer - stacked: dots, helper text, button */}
        <View style={styles.footer}>
          <View style={styles.dots}>
            {steps.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index === currentStep && styles.dotActive]}
              />
            ))}
          </View>

          <Text style={styles.gestureText}>{getGestureText()}</Text>

          <Button
            title={currentStep === steps.length - 1 ? "Get Started" : "Next"}
            variant="primary"
            onPress={handleNext}
            fullWidth
            style={styles.nextButton}
            textStyle={styles.nextButtonText}
          />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.white,
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    color: COLORS.white,
    textAlign: "center",
    lineHeight: 24,
    opacity: 0.9,
    paddingHorizontal: 16,
  },
  gestureDemo: {
    marginTop: 32,
    alignItems: "center",
  },
  card: {
    width: 160,
    height: 220,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  dotActive: {
    backgroundColor: COLORS.white,
    width: 24,
  },
  gestureText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 16,
  },
  nextButton: {
    backgroundColor: COLORS.white,
  },
  nextButtonText: {
    color: COLORS.primary,
  },
});
