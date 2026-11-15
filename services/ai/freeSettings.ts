import * as SecureStore from 'expo-secure-store';
import type { FreeConfig, FreeProvider } from './freeClient';

/**
 * Ücretsiz yapay zekâ anahtarları (isteğe bağlı). Claude anahtarı gibi yalnızca bu telefonun
 * güvenli deposunda tutulur. İki sağlayıcının anahtarı ayrı saklanır; biri seçilince diğeri silinmez.
 */
const KEY_PROVIDER = 'free_provider';
const keyFor = (p: FreeProvider) => (p === 'GEMINI' ? 'free_key_gemini' : 'free_key_groq');

export async function getFreeProvider(): Promise<FreeProvider> {
  const v = await SecureStore.getItemAsync(KEY_PROVIDER);
  return v === 'GROQ' ? 'GROQ' : 'GEMINI';
}

export async function setFreeProvider(p: FreeProvider): Promise<void> {
  await SecureStore.setItemAsync(KEY_PROVIDER, p);
}

export async function getFreeKey(p: FreeProvider): Promise<string | null> {
  const v = await SecureStore.getItemAsync(keyFor(p));
  return v && v.trim() ? v.trim() : null;
}

export async function setFreeKey(p: FreeProvider, key: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(p), key.trim());
}

export async function clearFreeKey(p: FreeProvider): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(p));
}

/**
 * Kullanılacak ücretsiz yapılandırma. Seçili sağlayıcının anahtarı yoksa ama diğerinin varsa onu
 * kullanır; hiçbiri yoksa null döner (kopyala-yapıştır yolu ve kurallar çalışmaya devam eder).
 */
export async function getFreeConfig(): Promise<FreeConfig | null> {
  const selected = await getFreeProvider();
  const other: FreeProvider = selected === 'GEMINI' ? 'GROQ' : 'GEMINI';
  const k1 = await getFreeKey(selected);
  if (k1) return { provider: selected, apiKey: k1 };
  const k2 = await getFreeKey(other);
  return k2 ? { provider: other, apiKey: k2 } : null;
}
