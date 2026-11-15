import * as SecureStore from 'expo-secure-store';

/**
 * API anahtarı yalnızca bu telefonda, işletim sisteminin güvenli deposunda (Android Keystore /
 * iOS Keychain) saklanır. Uygulama dosyasının (APK) içine gömülmez.
 */
const KEY_API = 'anthropic_api_key';
const KEY_MODEL = 'anthropic_model';

export const MODELS = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Hızlı ve ekonomik (önerilen başlangıç)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Daha derin ve dengeli yanıtlar' },
] as const;

export const DEFAULT_MODEL = MODELS[0].id;

export interface AiConfig {
  apiKey: string;
  model: string;
}

export async function getApiKey(): Promise<string | null> {
  const v = await SecureStore.getItemAsync(KEY_API);
  return v && v.trim() ? v.trim() : null;
}

export async function setApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_API, key.trim());
}

export async function clearApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_API);
}

export async function getModel(): Promise<string> {
  return (await SecureStore.getItemAsync(KEY_MODEL)) ?? DEFAULT_MODEL;
}

export async function setModel(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_MODEL, id);
}

/** Anahtar kayıtlıysa tam yapılandırmayı, değilse null döndürür (koçlar kural tabanlı çalışır). */
export async function getAiConfig(): Promise<AiConfig | null> {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  return { apiKey, model: await getModel() };
}
