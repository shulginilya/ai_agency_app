import { useLocalSearchParams, useRouter } from 'expo-router';
import { AgentDetail } from '@/screens/AgentDetail';

/**
 * Route wrapper only: pulls the id out of the URL and hands navigation down.
 * The screen itself lives in `src/screens` so it can be rendered in a test
 * without a router around it.
 */
export default function AgentDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  return <AgentDetail agentId={id ?? ''} onBack={router.back} />;
}
