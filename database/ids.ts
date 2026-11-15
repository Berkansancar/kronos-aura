/** Küçük, bağımlılıksız id üreteci. Örn: "tsk_lq3x9k_a8f2c1" */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}_${rand}`;
}
