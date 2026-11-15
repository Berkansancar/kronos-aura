/**
 * Gün akışı (saf mantık, test edilebilir): tek dokunuşla saat damgaları ve aralarındaki süreler.
 * Uyandım → Duş aldım → Minibüse bindim → Dükkana geldim → Dükkandan çıktım → (Minibüse bindim) → Eve geldim.
 */
import type { DayEvent, DayEventKind } from '../database/types';
import { formatDuration } from './format';

export const FLOW_KINDS: { kind: DayEventKind; label: string; icon: string }[] = [
  { kind: 'WAKE', label: 'Uyandım', icon: '☀' },
  { kind: 'SHOWER', label: 'Duş aldım', icon: '🚿' },
  { kind: 'BUS', label: 'Minibüse bindim', icon: '🚌' },
  { kind: 'SHOP_IN', label: 'Dükkana geldim', icon: '🏪' },
  { kind: 'SHOP_OUT', label: 'Dükkandan çıktım', icon: '🚪' },
  { kind: 'HOME', label: 'Eve geldim', icon: '🏠' },
];

export const kindLabel = (k: DayEventKind): string => FLOW_KINDS.find((x) => x.kind === k)?.label ?? k;

/** Geriye dönük girmek için "kaç dakika önce" seçenekleri (0 = şimdi) */
export const AGO_CHOICES = [0, 5, 10, 15, 30, 60] as const;

const ms = (iso: string) => new Date(iso).getTime();
const sorted = (events: DayEvent[]) => [...events].sort((a, b) => ms(a.at) - ms(b.at));

/** Sıradaki doğal adım; gün tamamlandıysa (eve geldi) null. */
export function nextKind(events: DayEvent[]): DayEventKind | null {
  const list = sorted(events);
  const last = list[list.length - 1];
  if (!last) return 'WAKE';
  switch (last.kind) {
    case 'WAKE':
      return 'SHOWER';
    case 'SHOWER':
      return 'BUS';
    case 'BUS': {
      const before = list[list.length - 2];
      // Dükkandan çıktıktan sonra binilen minibüs eve gider; aksi halde dükkana
      return before?.kind === 'SHOP_OUT' ? 'HOME' : 'SHOP_IN';
    }
    case 'SHOP_IN':
      return 'SHOP_OUT';
    case 'SHOP_OUT':
      return 'BUS';
    case 'HOME':
      return null;
  }
}

export interface FlowSegment {
  label: string;
  minutes: number;
}

export interface FlowSummary {
  wakeAt: Date | null;
  shopInAt: Date | null;
  shopOutAt: Date | null;
  homeAt: Date | null;
  /** Uyanıştan ilk minibüse kadar */
  prepMinutes: number | null;
  /** Minibüse binişten dükkana varışa */
  commuteToMinutes: number | null;
  /** Dükkana varıştan çıkışa (çıkış yoksa ve bugünse şimdiye kadar) */
  shopMinutes: number | null;
  shopOpen: boolean;
  /** Dükkandan sonra minibüse binişten eve varışa */
  commuteBackMinutes: number | null;
  segments: FlowSegment[];
}

const SEGMENT_LABELS: Record<string, string> = {
  'WAKE>SHOWER': 'Kalkıştan duşa',
  'SHOWER>BUS': 'Duştan minibüse',
  'WAKE>BUS': 'Hazırlık',
  'BUS>SHOP_IN': 'Yol (işe)',
  'SHOP_IN>SHOP_OUT': 'Dükkanda',
  'SHOP_OUT>BUS': 'Çıkıştan minibüse',
  'BUS>HOME': 'Yol (eve)',
  'SHOP_OUT>HOME': 'Çıkıştan eve',
};

const diffMin = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

export function buildFlow(events: DayEvent[], now: Date): FlowSummary {
  const list = sorted(events);
  const at = (e: DayEvent) => new Date(e.at);

  const segments: FlowSegment[] = [];
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1];
    const b = list[i];
    const label = SEGMENT_LABELS[`${a.kind}>${b.kind}`];
    if (label) segments.push({ label, minutes: diffMin(at(a), at(b)) });
  }

  const first = (k: DayEventKind) => list.find((e) => e.kind === k) ?? null;
  const wake = first('WAKE');
  const shopIn = first('SHOP_IN');
  const shopOut = shopIn ? (list.find((e) => e.kind === 'SHOP_OUT' && ms(e.at) > ms(shopIn.at)) ?? null) : null;
  const home = [...list].reverse().find((e) => e.kind === 'HOME') ?? null;

  const firstBus = list.find((e) => e.kind === 'BUS') ?? null;
  const prep = wake && firstBus && ms(firstBus.at) > ms(wake.at) ? diffMin(at(wake), at(firstBus)) : null;

  const busBefore = (target: DayEvent | null, after: DayEvent | null): DayEvent | null => {
    if (!target) return null;
    const cands = list.filter((e) => e.kind === 'BUS' && ms(e.at) < ms(target.at) && (!after || ms(e.at) > ms(after.at)));
    return cands[cands.length - 1] ?? null;
  };
  const busToShop = busBefore(shopIn, null);
  const busHome = busBefore(home, shopOut);

  const shopOpen = !!shopIn && !shopOut && now.getTime() > ms(shopIn.at);
  const shopMinutes = shopIn ? (shopOut ? diffMin(at(shopIn), at(shopOut)) : shopOpen ? diffMin(at(shopIn), now) : null) : null;

  return {
    wakeAt: wake ? at(wake) : null,
    shopInAt: shopIn ? at(shopIn) : null,
    shopOutAt: shopOut ? at(shopOut) : null,
    homeAt: home ? at(home) : null,
    prepMinutes: prep,
    commuteToMinutes: busToShop && shopIn ? diffMin(at(busToShop), at(shopIn)) : null,
    shopMinutes,
    shopOpen,
    commuteBackMinutes: busHome && home ? diffMin(at(busHome), at(home)) : null,
    segments,
  };
}

/** Özet satırları: "Hazırlık 1 sa 10 dk", "Yol 35 dk", "Dükkanda 9 sa" ... */
export function flowChips(f: FlowSummary): string[] {
  const chips: string[] = [];
  if (f.prepMinutes !== null) chips.push(`Hazırlık ${formatDuration(f.prepMinutes)}`);
  if (f.commuteToMinutes !== null) chips.push(`Yol (işe) ${formatDuration(f.commuteToMinutes)}`);
  if (f.shopMinutes !== null) chips.push(`Dükkanda ${formatDuration(f.shopMinutes)}${f.shopOpen ? ' (süren)' : ''}`);
  if (f.commuteBackMinutes !== null) chips.push(`Yol (eve) ${formatDuration(f.commuteBackMinutes)}`);
  return chips;
}

/** Damganın dakikasını `ago` dakika öncesine ayarlar. */
export const stampTime = (now: Date, minutesAgo: number): Date => new Date(now.getTime() - Math.max(0, minutesAgo) * 60_000);

/** Sabah "Uyandım" damgasından sonra Aura'nın kısa çağrısı. */
export const WAKE_WATER_PROMPT = 'Günaydın. Önce bir bardak su iyi gelir; aşağıdaki düğme tek dokunuşla kaydeder.';

/** Son 7 günün uyanış saatlerinin ortancası (dakika); yeterli veri yoksa null. Su hatırlatmasını buna göre kurmak için. */
export function typicalWakeMinute(wakes: Date[]): number | null {
  if (wakes.length < 3) return null;
  const mins = wakes.map((d) => d.getHours() * 60 + d.getMinutes()).sort((a, b) => a - b);
  return mins[Math.floor(mins.length / 2)];
}
