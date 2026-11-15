import { useEffect, useRef, useState } from 'react';
import { enhanceCoachMessage } from '../services/ai/coachAI';
import { AIError } from '../services/ai/claudeClient';
import { getAiConfig } from '../services/ai/settings';
import type { CoachContext, CoachMessage } from '../services/coachEngine';

export interface AIMessages {
  kronos: CoachMessage | null;
  aura: CoachMessage | null;
  /** OFF: anahtar yok · LOADING: yazılıyor · READY: hazır · ERROR: son deneme başarısız */
  status: 'OFF' | 'LOADING' | 'READY' | 'ERROR';
  error: string | null;
}

const EMPTY: AIMessages = { kronos: null, aura: null, status: 'OFF', error: null };

/**
 * Kural motorunun mesajlarını yapay zekâyla zenginleştirir.
 *
 * `situationKey` yalnızca durum gerçekten değiştiğinde (görev bitti, plan değişti...) değişir;
 * dakikalık saat farkları yeni istek başlatmaz. `refreshToken` (örn. 20 dakikada bir artan sayı)
 * aynı durumda mesajı tazelemek içindir. Hata olursa arayüz kural tabanlı mesajda kalır.
 */
export function useAICoachMessages(
  ctx: CoachContext | null,
  base: { kronos: CoachMessage; aura: CoachMessage } | null,
  situationKey: string,
  refreshToken: number
): AIMessages {
  const [state, setState] = useState<AIMessages>(EMPTY);
  const ctxRef = useRef(ctx);
  const baseRef = useRef(base);
  const lastKey = useRef('');
  ctxRef.current = ctx;
  baseRef.current = base;

  useEffect(() => {
    if (!situationKey) return;
    let cancelled = false;

    // Durum değiştiyse eski yapay zekâ metni artık yanlış olabilir; temizle.
    if (lastKey.current !== situationKey) {
      lastKey.current = situationKey;
      setState((s) => ({ ...s, kronos: null, aura: null }));
    }

    const timer = setTimeout(async () => {
      const cfg = await getAiConfig();
      if (cancelled) return;
      if (!cfg) {
        setState(EMPTY);
        return;
      }
      const c = ctxRef.current;
      const b = baseRef.current;
      if (!c || !b) return;

      setState((s) => ({ ...s, status: 'LOADING', error: null }));
      const [k, a] = await Promise.allSettled([
        enhanceCoachMessage('KRONOS', b.kronos, c, cfg),
        enhanceCoachMessage('AURA', b.aura, c, cfg),
      ]);
      if (cancelled) return;

      const firstError = [k, a].find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      const errorText = firstError
        ? firstError.reason instanceof AIError
          ? firstError.reason.message
          : 'Yapay zekâ yanıt vermedi.'
        : null;

      setState({
        kronos: k.status === 'fulfilled' ? k.value : null,
        aura: a.status === 'fulfilled' ? a.value : null,
        status: errorText && k.status === 'rejected' && a.status === 'rejected' ? 'ERROR' : 'READY',
        error: errorText,
      });
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [situationKey, refreshToken]);

  return state;
}
