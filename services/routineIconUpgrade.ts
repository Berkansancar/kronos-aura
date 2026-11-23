/**
 * Eski rutinlerin simgelerini bir kez yeniler (örn. "Öğle arası su şişesi doldurma" için şişe, "Bir bardak su iç"
 * için bardak). Yalnızca simgesi boş olanlara ya da yalnızca kategorinin varsayılan simgesini taşıyanlara dokunur;
 * kullanıcının kendi seçtiği simge asla değişmez. Bir kez çalışır (Setting tablosunda işaret tutulur).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, listRoutines, setSetting, updateRoutine } from '../database/repository';
import { upgradedRoutineIcon } from './routineLook';

export const ICON_UPGRADE_KEY = 'routine_icons_v2';

/** Yenilenen rutin sayısını döner; daha önce çalıştıysa 0. */
export async function upgradeRoutineIcons(db: SQLiteDatabase): Promise<number> {
  if ((await getSetting(db, ICON_UPGRADE_KEY)) === '1') return 0;
  let changed = 0;
  for (const status of ['ACTIVE', 'RETIRED'] as const) {
    for (const r of await listRoutines(db, status)) {
      const next = upgradedRoutineIcon(r);
      if (next === null) continue;
      await updateRoutine(db, r.id, { icon: next });
      changed += 1;
    }
  }
  await setSetting(db, ICON_UPGRADE_KEY, '1');
  return changed;
}
