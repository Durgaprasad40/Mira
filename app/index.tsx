import { Redirect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

export default function Index() {
  // For now, redirect to auth screen
  // In production, check auth state and redirect accordingly
  return <Redirect href="/(auth)/welcome" />;
}
