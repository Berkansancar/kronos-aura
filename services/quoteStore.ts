import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { OPENING_SETTING_KEY, QUOTES, QUOTE_BAG_KEY, isOpeningEnabled, nextQuoteIndex, parseBag, type Quote } from './quotes';

/** Sıradaki sözü seçer ve torbanın durumunu kaydeder. Kayıt başarısız olsa da söz yine döner. */
export async function loadNextQuote(db: SQLiteDatabase, rng: () => number = Math.random): Promise<Quote> {
  const bag = parseBag(await getSetting(db, QUOTE_BAG_KEY).catch(() => null), QUOTES.length);
  const { index, bag: next } = nextQuoteIndex(bag, QUOTES.length, rng);
  await setSetting(db, QUOTE_BAG_KEY, JSON.stringify(next)).catch(() => undefined);
  return QUOTES[index];
}

export async function getOpeningEnabled(db: SQLiteDatabase): Promise<boolean> {
  return isOpeningEnabled(await getSetting(db, OPENING_SETTING_KEY).catch(() => null));
}

export async function setOpeningEnabled(db: SQLiteDatabase, on: boolean): Promise<void> {
  await setSetting(db, OPENING_SETTING_KEY, on ? '1' : '0');
}
