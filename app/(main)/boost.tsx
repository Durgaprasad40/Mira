import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/stores';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';

const BOOST_OPTIONS = [
  { id: '1hr', duration: 1, price: 50, label: '1 Hour', popular: false },
  { id: '4hr', duration: 4, price: 100, label: '4 Hours', popular: true },
  { id: '24hr', duration: 24, price: 200, label: '24 Hours', popular: false },
];

export default function BoostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const { tier } = useSubscriptionStore();
  const isPremium = tier === 'premium';
  const [selectedBoost, setSelectedBoost] = useState<string>('4hr');
  const [activating, setActivating] = useState(false);

  const user = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const activateBoost = useMutation(api.subscriptions.activateBoost);
  const purchaseProduct = useMutation(api.subscriptions.purchaseProduct);

  const handleActivate = async () => {
    if (!userId) return;

    const boost = BOOST_OPTIONS.find((b) => b.id === selectedBoost);
    if (!boost) return;

    // Check if user has boost in inventory
    if (user?.boostsRemaining && user.boostsRemaining > 0) {
      setActivating(true);
      try {
        await activateBoost({ userId: userId as any, durationHours: boost.duration });
        Alert.alert('Success', `Your profile is now boosted for ${boost.duration} hour(s)!`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to activate boost');
      } finally {
        setActivating(false);
      }
    } else {
      // Purchase boost
      setActivating(true);
      try {
        await purchaseProduct({
          userId: userId as any,
          productId: `boost_${boost.duration}hr`,
          productType: 'boost',
          quantity: 1,
          price: boost.price,
          currency: 'INR',
          paymentProvider: 'razorpay',
          transactionId: `boost_${Date.now()}`,
        });
        Alert.alert('Success', `Boost purchased! Your profile is now boosted for ${boost.duration} hour(s)!`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to purchase boost');
      } finally {
        setActivating(false);
      }
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Boost Your Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.infoCard}>
          <Ionicons name="rocket" size={48} color={COLORS.primary} />
          <Text style={styles.infoTitle}>Get Seen by More People</Text>
          <Text style={styles.infoText}>
            Boost your profile to appear at the top of Discover feeds in your area.
            Get up to 10x more profile views!
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose Duration:</Text>
          {BOOST_OPTIONS.map((boost) => (
            <TouchableOpacity
              key={boost.id}
              style={[
                styles.boostCard,
                selectedBoost === boost.id && styles.boostCardSelected,
                boost.popular && styles.boostCardPopular,
              ]}
              onPress={() => setSelectedBoost(boost.id)}
            >
              {boost.popular && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularText}>MOST POPULAR</Text>
                </View>
              )}
              <View style={styles.boostHeader}>
                <Text style={styles.boostLabel}>{boost.label}</Text>
                <Text style={styles.boostPrice}>₹{boost.price}</Text>
              </View>
              <Text style={styles.boostDescription}>
                Your profile appears first for {boost.duration} hour{boost.duration > 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {user?.boostsRemaining && user.boostsRemaining > 0 && (
          <View style={styles.inventoryCard}>
            <Ionicons name="gift-outline" size={24} color={COLORS.primary} />
            <Text style={styles.inventoryText}>
              You have {user.boostsRemaining} boost{user.boostsRemaining > 1 ? 's' : ''} in your inventory
            </Text>
          </View>
        )}

        <View style={styles.benefitsCard}>
          <Text style={styles.benefitsTitle}>Boost Benefits:</Text>
          {[
            'Appear at top of Discover feeds',
            '10x more profile views',
            'Get more likes and matches',
            'Priority in search results',
          ].map((benefit, index) => (
            <View key={index} style={styles.benefitItem}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={
            activating
              ? 'Activating...'
              : user?.boostsRemaining && user.boostsRemaining > 0
              ? 'Activate Boost'
              : 'Purchase & Activate'
          }
          variant="primary"
          onPress={handleActivate}
          disabled={activating}
          fullWidth
        />
        <Text style={styles.footerText}>
          Selected: {BOOST_OPTIONS.find((b) => b.id === selectedBoost)?.label} - ₹
          {BOOST_OPTIONS.find((b) => b.id === selectedBoost)?.price}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  placeholder: {
    width: 24,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  infoCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.primary + '10',
    borderRadius: 16,
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  boostCard: {
    padding: 20,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    position: 'relative',
  },
  boostCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  boostCardPopular: {
    borderColor: COLORS.gold,
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    right: 16,
    backgroundColor: COLORS.gold,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  popularText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  boostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  boostLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  boostPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.primary,
  },
  boostDescription: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  inventoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.success + '10',
    borderRadius: 12,
    marginBottom: 24,
    gap: 12,
  },
  inventoryText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  benefitsCard: {
    padding: 20,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
  },
  benefitsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});
