import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function Phase1ReportPersonListRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(main)/settings/support' as any);
  }, [router]);

  return null;
}
