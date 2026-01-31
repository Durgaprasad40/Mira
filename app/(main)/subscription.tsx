import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, SUBSCRIPTION_PLANS, IAP_PRODUCTS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

export default function SubscriptionScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const subscriptionStatus = useQuery(
    api.subscriptions.getSubscriptionStatus,
    userId ? { userId: userId as any } : 'skip'
  );

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const purchaseSubscription = useMutation(api.subscriptions.purchaseSubscription);
  const purchaseProduct = useMutation(api.subscriptions.purchaseProduct);

  const handlePurchase = async (plan: typeof SUBSCRIPTION_PLANS[0]) => {
    if (!userId) return;

    // In production, integrate with payment provider (Razorpay, RevenueCat, etc.)
    Alert.alert(
      'Purchase Subscription',
      `This will purchase ${plan.tier} plan for ${plan.duration} month(s) at ₹${plan.price}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purchase',
          onPress: async () => {
            try {
              // Mock transaction ID - replace with actual payment processing
              const transactionId = `txn_${Date.now()}`;
              await purchaseSubscription({
                userId: userId as any,
                planId: plan.id,
                tier: plan.tier as "basic" | "premium",
                duration: plan.duration,
                price: plan.price,
                currency: 'INR',
                paymentProvider: 'razorpay',
                transactionId,
              });
              Alert.alert('Success', 'Subscription activated!');
              router.back();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to purchase subscription');
            }
          },
        },
      ]
    );
  };

  const handlePurchaseProduct = async (product: typeof IAP_PRODUCTS[0]) => {
    if (!userId) return;

    Alert.alert(
      'Purchase',
      `Purchase ${product.quantity} ${product.type} for ₹${product.price}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purchase',
          onPress: async () => {
            try {
              const transactionId = `txn_${Date.now()}`;
              await purchaseProduct({
                userId: userId as any,
                productId: product.id,
                productType: product.type,
                quantity: product.quantity,
                price: product.price,
                currency: 'INR',
                paymentProvider: 'razorpay',
                transactionId,
                boostDuration: product.duration,
              });
              Alert.alert('Success', 'Purchase completed!');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to purchase');
            }
          },
        },
      ]
    );
  };

  if (!currentUser || currentUser.gender === 'female') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.freeAccessContainer}>
          <Ionicons name="sparkles" size={64} color={COLORS.primary} />
          <Text style={styles.freeAccessTitle}>Full Free Access</Text>
          <Text style={styles.freeAccessText}>
            As a woman, you have full free access to all Mira features!
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={{ width: 24 }} />
      </View>

      {subscriptionStatus && (
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Current Status</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Tier:</Text>
            <Text style={styles.statusValue}>
              {subscriptionStatus.tier.charAt(0).toUpperCase() + subscriptionStatus.tier.slice(1)}
            </Text>
          </View>
          {subscriptionStatus.isSubscribed && subscriptionStatus.expiresAt && (
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Expires:</Text>
              <Text style={styles.statusValue}>
                {new Date(subscriptionStatus.expiresAt).toLocaleDateString()}
              </Text>
            </View>
          )}
          {subscriptionStatus.isInTrial && (
            <View style={styles.trialBanner}>
              <Ionicons name="gift" size={20} color={COLORS.warning} />
              <Text style={styles.trialText}>
                {subscriptionStatus.trialDaysRemaining} days of trial remaining
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Subscription Plans</Text>
        <Text style={styles.sectionSubtitle}>Choose a plan that works for you</Text>

        {SUBSCRIPTION_PLANS.filter((p) => p.tier === 'basic').map((plan) => (
          <View key={plan.id} style={styles.planCard}>
            <View style={styles.planHeader}>
              <Text style={styles.planTier}>Basic</Text>
              <Text style={styles.planPrice}>₹{plan.price}</Text>
            </View>
            <Text style={styles.planDuration}>{plan.duration} month{plan.duration > 1 ? 's' : ''}</Text>
            <Text style={styles.planPerMonth}>₹{plan.pricePerMonth}/month</Text>
            <View style={styles.planFeatures}>
              <Text style={styles.feature}>✓ Unlimited swipes</Text>
              <Text style={styles.feature}>✓ 10 messages/week</Text>
              <Text style={styles.feature}>✓ 5 Super Likes/week</Text>
              <Text style={styles.feature}>✓ Rewind swipes</Text>
              <Text style={styles.feature}>✓ See who liked you</Text>
              <Text style={styles.feature}>✓ 2 Boosts/month</Text>
            </View>
            <Button
              title="Subscribe"
              variant="primary"
              onPress={() => handlePurchase(plan)}
              style={styles.subscribeButton}
            />
          </View>
        ))}

        {SUBSCRIPTION_PLANS.filter((p) => p.tier === 'premium').map((plan) => (
          <View key={plan.id} style={[styles.planCard, styles.premiumCard]}>
            <View style={styles.premiumBadge}>
              <Ionicons name="star" size={16} color={COLORS.gold} />
              <Text style={styles.premiumBadgeText}>PREMIUM</Text>
            </View>
            <View style={styles.planHeader}>
              <Text style={styles.planTier}>Premium</Text>
              <Text style={styles.planPrice}>₹{plan.price}</Text>
            </View>
            <Text style={styles.planDuration}>{plan.duration} month{plan.duration > 1 ? 's' : ''}</Text>
            <Text style={styles.planPerMonth}>₹{plan.pricePerMonth}/month</Text>
            <View style={styles.planFeatures}>
              <Text style={styles.feature}>✓ Everything in Basic</Text>
              <Text style={styles.feature}>✓ Unlimited messages</Text>
              <Text style={styles.feature}>✓ Unlimited Super Likes</Text>
              <Text style={styles.feature}>✓ Unlimited Boosts</Text>
              <Text style={styles.feature}>✓ Full Incognito mode</Text>
              <Text style={styles.feature}>✓ Unlimited custom messages</Text>
            </View>
            <Button
              title="Subscribe"
              variant="primary"
              onPress={() => handlePurchase(plan)}
              style={styles.subscribeButton}
            />
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add-ons</Text>
        <Text style={styles.sectionSubtitle}>Boost your profile or get extra features</Text>

        <View style={styles.addonsGrid}>
          {IAP_PRODUCTS.filter((p) => p.type === 'boost').map((product) => (
            <TouchableOpacity
              key={product.id}
              style={styles.addonCard}
              onPress={() => handlePurchaseProduct(product)}
            >
              <Ionicons name="rocket" size={32} color={COLORS.primary} />
              <Text style={styles.addonTitle}>
                {product.duration}h Boost
              </Text>
              <Text style={styles.addonPrice}>₹{product.price}</Text>
            </TouchableOpacity>
          ))}

          {IAP_PRODUCTS.filter((p) => p.type === 'super_likes').map((product) => (
            <TouchableOpacity
              key={product.id}
              style={styles.addonCard}
              onPress={() => handlePurchaseProduct(product)}
            >
              <Ionicons name="star" size={32} color={COLORS.superLike} />
              <Text style={styles.addonTitle}>
                {product.quantity} Super Likes
              </Text>
              <Text style={styles.addonPrice}>₹{product.price}</Text>
            </TouchableOpacity>
          ))}

          {IAP_PRODUCTS.filter((p) => p.type === 'messages').map((product) => (
            <TouchableOpacity
              key={product.id}
              style={styles.addonCard}
              onPress={() => handlePurchaseProduct(product)}
            >
              <Ionicons name="chatbubbles" size={32} color={COLORS.secondary} />
              <Text style={styles.addonTitle}>
                {product.quantity} Messages
              </Text>
              <Text style={styles.addonPrice}>₹{product.price}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
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
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  freeAccessContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  freeAccessTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  freeAccessText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 24,
  },
  statusCard: {
    backgroundColor: COLORS.backgroundDark,
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  trialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '20',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  trialText: {
    fontSize: 14,
    color: COLORS.warning,
    marginLeft: 8,
    fontWeight: '500',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 20,
  },
  planCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  premiumCard: {
    borderColor: COLORS.gold,
    position: 'relative',
  },
  premiumBadge: {
    position: 'absolute',
    top: -12,
    right: 20,
    backgroundColor: COLORS.gold,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  premiumBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
    marginLeft: 4,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planTier: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  planPrice: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary,
  },
  planDuration: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  planPerMonth: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 20,
  },
  planFeatures: {
    marginBottom: 20,
  },
  feature: {
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 8,
    lineHeight: 22,
  },
  subscribeButton: {
    marginTop: 8,
  },
  addonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  addonCard: {
    width: '48%',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  addonPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
