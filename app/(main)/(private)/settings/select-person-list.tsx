import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function Phase2SelectPersonListRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(main)/(private)/settings/private-support' as any);
  }, [router]);

  return null;
}
