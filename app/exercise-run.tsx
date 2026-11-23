import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { loadExercise, saveExerciseSession } from '../services/exercise';
import {
  ALT_REST_SECONDS,
  EXERCISES,
  EXERCISE_BY_ID,
  LEVEL_NAMES,
  REST_CHOICES,
  SESSION_BLOCKS,
  SESSION_MINUTES,
  WARMUP_STEPS,
  type ExerciseMove,
  type Level,
  type MoveId,
} from '../services/exerciseData';
import {
  defaultState,
  estimateMinutes,
  lastResult,
  setsLine,
  targetLine,
  variantFor,
  windowText,
  type ExerciseState,
  type LevelUp,
  type SessionItem,
} from '../services/exerciseLogic';
import { refreshReminders } from '../services/reminderSync';

interface SetRow {
  reps: number;
  done: boolean;
}
type Plan = Record<MoveId, SetRow[]>;

/** Her hareket için set satırları: başlangıç değeri geçen seferki sonuç, yoksa hedefin alt sınırı. */
function buildPlan(state: ExerciseState): Plan {
  const plan = {} as Plan;
  for (const m of EXERCISES) {
    const level = state.levels[m.id];
    const v = variantFor(m.id, level);
    const last = lastResult(state, m.id);
    const prev = last && last.item.level === level ? last.item.sets : [];
    plan[m.id] = Array.from({ length: v.sets }, (_, i) => ({
      reps: Math.min(v.max, Math.max(v.min, prev[i] ?? v.min)),
      done: false,
    }));
  }
  return plan;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const restLabel = (s: number) => (s >= 120 ? `${Math.round(s / 60)} dk` : `${s} sn`);
const hasDone = (p: Plan) => Object.values(p).some((rows) => rows.some((r) => r.done));

export default function ExerciseRunScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ExerciseState>(defaultState());
  const [plan, setPlan] = useState<Plan | null>(null);
  // Set satırlarının hazırlandığı basamaklar: kayıt da bunlarla yapılır, böylece satırlarla kayıt tutarsız olmaz
  const [planLevels, setPlanLevels] = useState<Record<MoveId, Level> | null>(null);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;
  const [restSeconds, setRestSeconds] = useState(ALT_REST_SECONDS);
  const [restEnd, setRestEnd] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ sets: number; moves: number; levelUps: LevelUp[] } | null>(null);
  const buzzed = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadExercise(db)
        .then((s) => {
          if (!alive) return;
          setState(s);
          // İşaretlenmiş set yoksa satırları güncel basamaklarla yeniden kur (başka ekranda basamak değişmiş olabilir)
          const cur = planRef.current;
          if (!cur || !hasDone(cur)) {
            setPlan(buildPlan(s));
            setPlanLevels({ ...s.levels });
          }
        })
        .catch((e) => Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [db])
  );

  // Dinlenme sayacı: süre bitince bir kez titreşir
  useEffect(() => {
    if (restEnd === null) return;
    buzzed.current = false;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= restEnd && !buzzed.current) {
        buzzed.current = true;
        Vibration.vibrate([0, 400, 200, 400]);
      }
    }, 500);
    return () => clearInterval(id);
  }, [restEnd]);

  const levels = planLevels ?? state.levels;
  const remaining = restEnd === null ? null : Math.max(0, Math.ceil((restEnd - now) / 1000));
  const estimate = estimateMinutes(levels, restSeconds);

  const update = (move: MoveId, i: number, patch: Partial<SetRow>) => {
    setPlan((p) => (p ? { ...p, [move]: p[move].map((r, j) => (j === i ? { ...r, ...patch } : r)) } : p));
  };

  const toggleDone = (move: MoveId, i: number) => {
    if (!plan) return;
    const row = plan[move][i];
    update(move, i, { done: !row.done });
    if (!row.done) {
      setNow(Date.now());
      setRestEnd(Date.now() + restSeconds * 1000);
    }
  };

  const finish = async () => {
    if (!plan || saving) return;
    const items: SessionItem[] = [];
    for (const m of EXERCISES) {
      const sets = plan[m.id].filter((r) => r.done).map((r) => r.reps);
      if (sets.length > 0) items.push({ move: m.id, level: levels[m.id], sets });
    }
    if (items.length === 0) {
      Alert.alert('Henüz set yok', 'Bitirdiğin setin yanındaki daireye dokunarak işaretle, sonra kaydet.');
      return;
    }
    setSaving(true);
    try {
      const res = await saveExerciseSession(db, items);
      setState(res.state);
      setRestEnd(null);
      setResult({ sets: items.reduce((n, it) => n + it.sets.length, 0), moves: items.length, levelUps: res.levelUps });
      // Bugün yapıldığı için bugünkü egzersiz bildirimi artık gelmesin
      refreshReminders(db).catch(() => undefined);
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.heading}>Seans kaydedildi 💪</Text>
          <View style={styles.doneCard}>
            <Text style={styles.doneBig}>
              {result.moves} hareket, {result.sets} set
            </Text>
            <Text style={styles.muted}>Güne iyi başladın. Bir sonraki seansa kadar en az bir gün ara ver.</Text>
          </View>
          {result.levelUps.length > 0 && (
            <View style={styles.levelCard}>
              <Text style={styles.label}>YENİ BASAMAK</Text>
              {result.levelUps.map((u) => (
                <Text key={u.move} style={styles.levelText}>
                  {EXERCISE_BY_ID[u.move].title}: {LEVEL_NAMES[u.to]} basamağa geçtin, {variantFor(u.move, u.to).name}.
                </Text>
              ))}
            </View>
          )}
          <Pressable onPress={() => router.back()} style={styles.primary}>
            <Text style={styles.primaryText}>Tamam</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const doneCount = plan ? Object.values(plan).reduce((n, rows) => n + rows.filter((r) => r.done).length, 0) : 0;

  const renderMove = (m: ExerciseMove) => {
    if (!plan) return null;
    const level = levels[m.id];
    const v = variantFor(m.id, level);
    const last = lastResult(state, m.id);
    const step = v.unit === 'sec' ? 5 : 1;
    const upper = v.unit === 'sec' ? 120 : 30;
    return (
      <View key={m.id} style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardIcon}>{m.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{v.name}</Text>
            <Text style={styles.muted}>
              {m.title} · {LEVEL_NAMES[level]} · {targetLine(v)}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => router.push({ pathname: '/exercise-move', params: { move: m.id, level: String(level) } })} hitSlop={6}>
          <Text style={styles.link}>Çizimi ve anlatımı gör ›</Text>
        </Pressable>
        {last && last.item.level === level && <Text style={styles.muted}>Geçen sefer: {setsLine(v, last.item.sets)}</Text>}
        {plan[m.id].map((row, i) => (
          <View key={i} style={[styles.setRow, row.done && styles.setRowDone]}>
            <Text style={styles.setLabel}>Set {i + 1}</Text>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => update(m.id, i, { reps: Math.max(0, row.reps - step) })}
                style={styles.stepBtn}
                hitSlop={6}
                disabled={row.done}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.reps}>
                {row.reps}
                <Text style={styles.repsUnit}> {v.unit === 'sec' ? 'sn' : v.perSide ? 'tekrar / taraf' : 'tekrar'}</Text>
              </Text>
              <Pressable
                onPress={() => update(m.id, i, { reps: Math.min(upper, row.reps + step) })}
                style={styles.stepBtn}
                hitSlop={6}
                disabled={row.done}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => toggleDone(m.id, i)} style={[styles.check, row.done && styles.checkOn]} hitSlop={8}>
              <Text style={[styles.checkText, row.done && { color: colors.bg }]}>✓</Text>
            </Pressable>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      {remaining !== null && (
        <View style={[styles.restBar, remaining === 0 && styles.restBarDone]}>
          <Text style={styles.restText}>{remaining === 0 ? 'Dinlenme bitti, sıradaki sete geç' : `Dinlen: ${mmss(remaining)}`}</Text>
          <Pressable onPress={() => setRestEnd(null)} hitSlop={10}>
            <Text style={styles.restSkip}>{remaining === 0 ? 'Kapat' : 'Atla'}</Text>
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Sabah seansı</Text>
        <Text style={styles.muted}>
          Tahmini süre: yaklaşık {estimate} dk (hedef {SESSION_MINUTES} dk, {windowText(state.plan)}).
          {estimate > SESSION_MINUTES ? ' Yetişmezse son bloğu (karın) atlayabilirsin.' : ''}
        </Text>

        <View style={styles.restCard}>
          <Text style={styles.label}>SETLER ARASI DİNLENME</Text>
          <View style={styles.chips}>
            {REST_CHOICES.map((s) => (
              <Pressable key={s} onPress={() => setRestSeconds(s)} style={[styles.chip, s === restSeconds && styles.chipOn]}>
                <Text style={[styles.chipText, s === restSeconds && styles.chipTextOn]}>{restLabel(s)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.muted}>
            Hareketleri dönüşümlü yaptığın için 60 sn yeterli: aynı hareketin iki seti arası yaklaşık 3 dakika olur. Seti işaretleyince sayaç başlar.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Isınma (yaklaşık 2 dk)</Text>
          {WARMUP_STEPS.map((w, i) => (
            <Text key={i} style={styles.warm}>
              • {w}
            </Text>
          ))}
        </View>

        {loading || !plan ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            {SESSION_BLOCKS.map((block, bi) => {
              const moves = block.map((id) => EXERCISE_BY_ID[id]);
              const names = moves.map((m) => variantFor(m.id, levels[m.id]).name);
              return (
                <View key={bi} style={{ gap: spacing.md }}>
                  <View>
                    <Text style={styles.blockTitle}>
                      Blok {bi + 1} · {moves.map((m) => m.title).join(' ↔ ')}
                    </Text>
                    <Text style={styles.muted}>
                      {moves.length > 1
                        ? `Sırayla yap: ${names[0]} seti, dinlen, ${names[1]} seti, dinlen, tekrar. Üç tur.`
                        : 'Seti yap, dinlen, tekrar. Üç tur.'}
                    </Text>
                  </View>
                  {moves.map(renderMove)}
                </View>
              );
            })}

            <Pressable onPress={finish} disabled={saving} style={[styles.primary, doneCount === 0 && { opacity: 0.55 }]}>
              <Text style={styles.primaryText}>{saving ? 'Kaydediliyor…' : `Bitir ve kaydet (${doneCount} set)`}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  link: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  blockTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: spacing.sm },
  warm: { color: colors.text, fontSize: 13, lineHeight: 19 },
  restCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: colors.aura },
  restBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.kronos,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  restBarDone: { backgroundColor: colors.aura },
  restText: { color: colors.bg, fontSize: 16, fontWeight: '800' },
  restSkip: { color: colors.bg, fontSize: 14, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cardIcon: { fontSize: 26 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  setRowDone: { backgroundColor: colors.auraSoft },
  setLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', width: 44 },
  stepper: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 22 },
  reps: { color: colors.text, fontSize: 20, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  repsUnit: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  check: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.aura,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.aura },
  checkText: { color: colors.aura, fontSize: 18, fontWeight: '800' },
  primary: { backgroundColor: colors.aura, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  doneCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  doneBig: { color: colors.text, fontSize: 20, fontWeight: '800' },
  levelCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  levelText: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
