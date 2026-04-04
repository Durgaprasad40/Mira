import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/config/demo';
import { INCOGNITO_COLORS } from '@/lib/constants';

// Room creation cost
const ROOM_COST = 1;

const C = INCOGNITO_COLORS;

export default function CreateRoomScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);

  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createPrivateRoomMut = useMutation(api.chatRooms.createPrivateRoom);

  // COIN-UX-FIX: Query user's coin balance
  const walletQuery = useQuery(
    api.chatRooms.getUserWalletCoins,
    userId ? { authUserId: userId } : 'skip'
  );
  const currentCoins = walletQuery?.walletCoins ?? 0;
  const hasEnoughCoins = currentCoins >= ROOM_COST;
  const shortfall = Math.max(0, ROOM_COST - currentCoins);

  const handleCreate = useCallback(async () => {
    const trimmedName = roomName.trim();
    const trimmedPassword = password.trim();

    if (!trimmedName) {
      Alert.alert('Error', 'Please enter a room name');
      return;
    }

    if (trimmedName.length < 2) {
      Alert.alert('Error', 'Room name must be at least 2 characters');
      return;
    }

    if (trimmedName.length > 50) {
      Alert.alert('Error', 'Room name must be 50 characters or less');
      return;
    }

    if (!trimmedPassword) {
      Alert.alert('Error', 'Please enter a password');
      return;
    }

    if (trimmedPassword.length < 4) {
      Alert.alert('Error', 'Password must be at least 4 characters');
      return;
    }

    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in to create a private room.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createPrivateRoomMut({
        name: trimmedName,
        password: trimmedPassword,
        authUserId: userId!,
      });

      // Navigate to the new room
      router.replace(`/(main)/(private)/(tabs)/chat-rooms/${result.roomId}` as any);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create room');
    } finally {
      setIsSubmitting(false);
    }
  }, [roomName, password, userId, createPrivateRoomMut, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Chat Room</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Room Name Input */}
        <Text style={styles.label}>Room Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter room name..."
          placeholderTextColor={C.textLight}
          value={roomName}
          onChangeText={setRoomName}
          maxLength={50}
          autoFocus
        />
        <Text style={styles.charCount}>{roomName.length}/50</Text>

        {/* Password Input */}
        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Enter password (min 4 chars)..."
            placeholderTextColor={C.textLight}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPassword(!showPassword)}
          >
            <Ionicons
              name={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color={C.textLight}
            />
          </TouchableOpacity>
        </View>

        {/* COIN-UX-FIX: Coin Info Section */}
        <View style={styles.coinSection}>
          <View style={styles.coinHeader}>
            <Ionicons name="wallet-outline" size={20} color={C.text} />
            <Text style={styles.coinTitle}>Room Cost</Text>
          </View>

          {/* Balance Row */}
          <View style={styles.coinRow}>
            <Text style={styles.coinLabel}>Your balance</Text>
            <Text style={[styles.coinValue, !hasEnoughCoins && styles.coinValueInsufficient]}>
              {currentCoins} coins
            </Text>
          </View>

          {/* Required Row */}
          <View style={styles.coinRow}>
            <Text style={styles.coinLabel}>Required</Text>
            <Text style={styles.coinValue}>{ROOM_COST} coin for 24 hours</Text>
          </View>

          {/* Shortfall Row (only if insufficient) */}
          {!hasEnoughCoins && (
            <View style={styles.coinRow}>
              <Text style={styles.coinLabel}>You need</Text>
              <Text style={styles.coinValueShortfall}>{shortfall} more coin{shortfall !== 1 ? 's' : ''}</Text>
            </View>
          )}

          {/* Status Message */}
          <View style={[styles.coinStatus, hasEnoughCoins ? styles.coinStatusOk : styles.coinStatusWarn]}>
            <Ionicons
              name={hasEnoughCoins ? 'checkmark-circle' : 'alert-circle'}
              size={16}
              color={hasEnoughCoins ? '#22C55E' : '#F59E0B'}
            />
            <Text style={[styles.coinStatusText, hasEnoughCoins ? styles.coinStatusTextOk : styles.coinStatusTextWarn]}>
              {hasEnoughCoins
                ? 'You have enough coins to create this room'
                : 'Chat and engage with more people to earn coins'}
            </Text>
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.createBtn,
            (isSubmitting || !hasEnoughCoins) && styles.createBtnDisabled,
          ]}
          onPress={handleCreate}
          disabled={isSubmitting || !hasEnoughCoins}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.createBtnText}>
              {hasEnoughCoins ? 'Create Room' : 'Not Enough Coins'}
            </Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.text,
    borderWidth: 1,
    borderColor: C.surface,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.surface,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.text,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  // COIN-UX-FIX: Coin info section styles
  coinSection: {
    marginTop: 24,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
  },
  coinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  coinTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  coinRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  coinLabel: {
    fontSize: 14,
    color: C.textLight,
  },
  coinValue: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  coinValueInsufficient: {
    color: '#F59E0B',
  },
  coinValueShortfall: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
  coinStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  coinStatusOk: {},
  coinStatusWarn: {},
  coinStatusText: {
    fontSize: 13,
    flex: 1,
  },
  coinStatusTextOk: {
    color: '#22C55E',
  },
  coinStatusTextWarn: {
    color: '#F59E0B',
  },
  createBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  createBtnDisabled: {
    opacity: 0.6,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
