/**
 * Görev sonuçları: Yaptım / Yapmadım / Yapamadım (saf mantık, test edilebilir).
 *
 * Aura üç cevabı da aynı sıcaklıkla karşılar: "yapmadım" ve "yapamadım" birer veridir, borç ya da suç değildir.
 */
import type { TaskOutcome, TaskOutcomeKind, TaskOutcomeReason } from '../database/types';
import type { CoachMessage } from './coachEngine';

export const OUTCOME_LABEL: Record<TaskOutcomeKind, string> = {
  DONE: 'Yaptım',
  NOT_DONE: 'Yapmadım',
  COULD_NOT: 'Yapamadım',
};

export const REASON_CHOICES: { id: TaskOutcomeReason; label: string }[] = [
  { id: 'WORK', label: 'İş vaktindeydi' },
  { id: 'ENERGY', label: 'Enerjim yoktu' },
  { id: 'TIME', label: 'Zamanım yetmedi' },
  { id: 'OTHER', label: 'Başka bir şey çıktı' },
];

export const reasonLabel = (r: TaskOutcomeReason | null): string | null =>
  r ? (REASON_CHOICES.find((x) => x.id === r)?.label ?? null) : null;

/** Aura'nın üç cevaba kısa yanıtı. */
export function auraOutcomeReply(kind: TaskOutcomeKind, title: string, reason: TaskOutcomeReason | null = null): CoachMessage {
  let headline: string;
  let body: string;
  if (kind === 'DONE') {
    headline = 'Kayda geçti';
    body = `"${title}" tamam. Bu da günün kaydına eklendi.`;
  } else if (kind === 'NOT_DONE') {
    headline = 'Not aldım';
    body = `"${title}" bugün yapılmadı; sorun değil. Yarın yeniden plana alırım, istersen listeden de silebilirsin.`;
  } else {
    headline = 'Anlıyorum';
    const bodies: Record<TaskOutcomeReason, string> = {
      WORK: `İş vaktine denk gelmiş. "${title}" yarına kalıyor; iş vaktinde yapılabilir diye işaretlersen gün içine de yer ayırırım.`,
      ENERGY: `Enerji yokken zorlamak yerine dinlenmek doğru. "${title}" yarına kalıyor.`,
      TIME: `Zaman yetmedi; bu iyi bir planlama verisi. "${title}" yarın için yeniden planlanacak.`,
      OTHER: `Hayat araya girer. "${title}" yarına kalıyor.`,
    };
    body = reason ? bodies[reason] : `"${title}" yarına kalıyor; olmadığı günler de olur, bir borç oluşmadı.`;
  }
  return { coach: 'AURA', tone: 'CALM', headline, body, actions: [] };
}

/** Aynı görev için birden çok kayıt varsa son kaydı tutar (görevsiz kayıtlar ayrı sayılır). */
export function latestOutcomes(list: TaskOutcome[]): TaskOutcome[] {
  const byKey = new Map<string, TaskOutcome>();
  for (const o of list) byKey.set(o.taskId ?? o.id, o);
  return [...byKey.values()];
}

export interface OutcomeSummary {
  done: TaskOutcome[];
  notDone: TaskOutcome[];
  couldNot: TaskOutcome[];
  /** "Yapamadım" diyenlerden iş vaktini sebep gösterenler */
  blockedByWork: TaskOutcome[];
  total: number;
}

export function summarizeOutcomes(list: TaskOutcome[]): OutcomeSummary {
  const latest = latestOutcomes(list);
  const couldNot = latest.filter((o) => o.outcome === 'COULD_NOT');
  return {
    done: latest.filter((o) => o.outcome === 'DONE'),
    notDone: latest.filter((o) => o.outcome === 'NOT_DONE'),
    couldNot,
    blockedByWork: couldNot.filter((o) => o.reason === 'WORK'),
    total: latest.length,
  };
}

/** Kısa özet: "2 yaptım · 1 yapmadım · 1 yapamadım" (sıfır olanlar yazılmaz). */
export function outcomeLine(s: OutcomeSummary): string {
  const parts: string[] = [];
  if (s.done.length > 0) parts.push(`${s.done.length} yaptım`);
  if (s.notDone.length > 0) parts.push(`${s.notDone.length} yapmadım`);
  if (s.couldNot.length > 0) parts.push(`${s.couldNot.length} yapamadım`);
  return parts.join(' · ');
}
