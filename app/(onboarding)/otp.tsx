import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter, Redirect } from "expo-router";
import { COLORS, VALIDATION } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isDemoMode } from "@/hooks/useConvex";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";

export default function OTPScreen() {
  const { email, phone, setStep } = useOnboardingStore();
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const demoUserProfile = useDemoStore((s) => s.demoUserProfile);

  // Demo mode: never show OTP screen — redirect immediately
  if (isDemoMode) {
    if (demoUserProfile) {
      return <Redirect href={"/(main)/(tabs)/home" as any} />;
    }
    return <Redirect href={"/demo-profile" as any} />;
  }
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [hasSentOTP, setHasSentOTP] = useState(false);

  const sendOTP = useMutation(api.auth.sendOTP);
  const verifyOTP = useMutation(api.auth.verifyOTP);

  const identifier = email || phone || "";
  const type = email ? "email" : "phone";

  // Send OTP on mount
  useEffect(() => {
    if (!hasSentOTP && identifier) {
      handleSendOTP();
    }
  }, [identifier]);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSendOTP = async () => {
    if (!identifier) {
      Alert.alert("Error", "No email or phone number provided");
      return;
    }

    try {
      await sendOTP({ identifier, type: type as "email" | "phone" });
      setHasSentOTP(true);
      // In demo mode, show the OTP hint
      Alert.alert(
        "OTP Sent",
        "Check the console for your OTP code (demo mode)",
      );
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to send OTP");
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    if (value.length > 1) return; // Only allow single digit

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const otpCode = otp.join("");
    if (otpCode.length !== VALIDATION.OTP_LENGTH) {
      Alert.alert("Invalid OTP", "Please enter the complete 6-digit code");
      return;
    }

    setIsVerifying(true);
    try {
      const result = await verifyOTP({ identifier, code: otpCode });
      if (result.verified) {
        setStep("password");
        router.push("/(onboarding)/password");
      }
    } catch (error: any) {
      Alert.alert(
        "Verification Failed",
        error.message || "Invalid OTP. Please try again.",
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;

    try {
      await sendOTP({ identifier, type: type as "email" | "phone" });
      setResendTimer(60);
      Alert.alert("OTP Sent", "A new verification code has been sent");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to resend OTP");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter verification code</Text>
      <Text style={styles.subtitle}>
        We sent a {VALIDATION.OTP_LENGTH}-digit code to{"\n"}
        {email || phone || "your contact"}
      </Text>

      <View style={styles.otpContainer}>
        {otp.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              inputRefs.current[index] = ref;
            }}
            style={[styles.otpInput, digit && styles.otpInputFilled]}
            value={digit}
            onChangeText={(value) => handleOtpChange(value, index)}
            onKeyPress={({ nativeEvent }) =>
              handleKeyPress(nativeEvent.key, index)
            }
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
          />
        ))}
      </View>

      <View style={styles.resendContainer}>
        <Text style={styles.resendText}>Didn't receive the code? </Text>
        <TouchableOpacity onPress={handleResend} disabled={resendTimer > 0}>
          <Text
            style={[
              styles.resendLink,
              resendTimer > 0 && styles.resendLinkDisabled,
            ]}
          >
            {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Button
          title="Verify"
          variant="primary"
          onPress={handleVerify}
          loading={isVerifying}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 40,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 40,
    textAlign: "center",
    lineHeight: 22,
  },
  otpContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 12,
  },
  otpInput: {
    width: 50,
    height: 60,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 12,
    textAlign: "center",
    fontSize: 24,
    fontWeight: "600",
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
  },
  otpInputFilled: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + "10",
  },
  resendContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
  },
  resendText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  resendLink: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "600",
  },
  resendLinkDisabled: {
    color: COLORS.textLight,
  },
  footer: {
    marginTop: "auto",
    paddingBottom: 24,
  },
});
