import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/query/QueryProvider';
import { useTheme } from '@/theme';

export default function RootLayout() {
  const { colors } = useTheme();
  return (
    <QueryProvider>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* Pushed over the tabs: the chat is a place you go into and come back from. */}
          <Stack.Screen name="agent/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </QueryProvider>
  );
}
