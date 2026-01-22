import { View, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/ui';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';

export default function WelcomeScreen() {
  const router = useRouter();
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Mira</Text>
      <Text style={styles.subtitle}>Find your perfect match</Text>
      
      <View style={styles.buttonContainer}>
        <Button 
          title="Get Started" 
          variant="primary" 
          onPress={() => router.push('/(auth)/login')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textLight,
    marginBottom: 40,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
  },
});
