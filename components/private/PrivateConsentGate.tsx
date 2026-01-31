import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

export function PrivateConsentGate({ onAccept }: { onAccept: () => void }) {
  const insets = useSafeAreaInsets();
  const [agreed, setAgreed] = useState(false);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.consentContent}>
        <View style={styles.consentIconWrap}>
          <Ionicons name="shield-checkmark" size={56} color={C.primary} />
        </View>
        <Text style={styles.consentTitle}>Private Mode</Text>
        <Text style={styles.consentSubtitle}>
          Consent-first connections. Your space, your boundaries.
        </Text>

        <View style={styles.consentSection}>
          <Text style={styles.consentSectionTitle}>Before you enter</Text>
          <Text style={styles.consentText}>
            Private Mode is an 18+ space designed for discreet, consensual connections.
            By entering, you confirm:
          </Text>
        </View>

        <View style={styles.consentRuleRow}>
          <Ionicons name="checkmark-circle" size={20} color={C.primary} />
          <Text style={styles.consentRuleText}>I am 18 years of age or older</Text>
        </View>
        <View style={styles.consentRuleRow}>
          <Ionicons name="checkmark-circle" size={20} color={C.primary} />
          <Text style={styles.consentRuleText}>I will respect other users' boundaries and consent</Text>
        </View>
        <View style={styles.consentRuleRow}>
          <Ionicons name="checkmark-circle" size={20} color={C.primary} />
          <Text style={styles.consentRuleText}>No inappropriate content, explicit material, or solicitation</Text>
        </View>
        <View style={styles.consentRuleRow}>
          <Ionicons name="checkmark-circle" size={20} color={C.primary} />
          <Text style={styles.consentRuleText}>Harassment or abuse will result in a ban</Text>
        </View>

        <View style={styles.consentSection}>
          <Text style={styles.consentSectionTitle}>Community Guidelines</Text>
          <Text style={styles.consentText}>
            - Be respectful and kind{'\n'}
            - No sharing of explicit or inappropriate content{'\n'}
            - No solicitation of paid services or meetups{'\n'}
            - No non-consensual content or behavior{'\n'}
            - Report any violations using the report button
          </Text>
        </View>

        <TouchableOpacity style={styles.consentCheckRow} onPress={() => setAgreed(!agreed)}>
          <Ionicons
            name={agreed ? 'checkbox' : 'square-outline'}
            size={22}
            color={agreed ? C.primary : C.textLight}
          />
          <Text style={styles.consentCheckText}>
            I confirm I am 18+ and agree to the Private Mode guidelines
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.consentAcceptBtn, !agreed && styles.consentAcceptBtnDisabled]}
          onPress={agreed ? onAccept : undefined}
          disabled={!agreed}
        >
          <Text style={styles.consentAcceptBtnText}>Enter Private Mode</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  consentContent: { padding: 24, paddingBottom: 60 },
  consentIconWrap: { alignItems: 'center', marginTop: 20, marginBottom: 16 },
  consentTitle: { fontSize: 26, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 8 },
  consentSubtitle: { fontSize: 15, color: C.textLight, textAlign: 'center', marginBottom: 24 },
  consentSection: { marginBottom: 16 },
  consentSectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 8 },
  consentText: { fontSize: 14, color: C.textLight, lineHeight: 22 },
  consentRuleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12, paddingLeft: 4 },
  consentRuleText: { fontSize: 14, color: C.text, flex: 1, lineHeight: 20 },
  consentCheckRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, backgroundColor: C.surface, borderRadius: 12, marginTop: 20, marginBottom: 20,
  },
  consentCheckText: { fontSize: 14, color: C.text, flex: 1, lineHeight: 20 },
  consentAcceptBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center',
  },
  consentAcceptBtnDisabled: { backgroundColor: C.surface },
  consentAcceptBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
