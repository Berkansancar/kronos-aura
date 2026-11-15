import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../constants/theme';
import { DB_NAME, migrateDbIfNeeded } from '../database/schema';

function Loading() {
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <ActivityIndicator color={colors.kronos} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrateDbIfNeeded} useSuspense>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="chat" />
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}
