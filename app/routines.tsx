import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { RoutineEditor, type RoutineDraft } from '../components/RoutineEditor';
import { colors, radius, spacing } from '../constants/theme';
import { listRoutines, updateRoutine } from '../database/repository';
import type { Routine, RoutineBrief, RoutineCategory } from '../database/types';
import { loadRoutineBriefs } from '../services/routineBriefs';
import {
  addCustomRoutine,
  addRoutineFromTemplate,
  addRoutinePack,
  changeRoutineDuration,
  changeRoutineTime,
  restoreRoutine,
  retireRoutine,
} from '../services/routineFlow';
import { formatAskTime, todayProgress } from '../services/routineLogic';
import { refreshReminders } from '../services/reminderSync';
import { askNotificationPermission, hasNotificationPermission } from '../services/routineReminders';
import { CATEGORY_LABEL, ROUTINE_PACKS, ROUTINE_TEMPLATES } from '../services/routineTemplates';
import { routineColor, routineIcon } from '../services/routineLook';
import { daysLabel, routineDaysLabel, serializeDays } from '../services/routineDaysLogic';

const CATEGORY_ORDER: RoutineCategory[] = ['SAGLIK', 'ZIHIN', 'ODAK', 'DUZEN'];

export default function RoutinesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [briefs, setBriefs] = useState<RoutineBrief[]>([]);
  const [retired, setRetired] = useState<Routine[]>([]);
  const [notifOk, setNotifOk] = useState(true);
  const [editor, setEditor] = useState<{ open: boolean; routine: Routine | null }>({
    open: false,
    routine: null,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const now = new Date();
    const b = await loadRoutineBriefs(db, now);
    setBriefs(b);
    setRetired(await listRoutines(db, 'RETIRED'));
    setNotifOk(await hasNotificationPermission());
    await refreshReminders(db, now, b);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load])
  );

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
        await load();
      } catch (e) {
        Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const activeTemplateIds = useMemo(
    () => new Set(briefs.map((b) => b.routine.templateId).filter((x): x is string => !!x)),
    [briefs]
  );
  const progress = todayProgress(briefs);

  // İlk rutin eklenince bildirim izni istenir (Android 13+ için gerekli).
  const withPermissionPrompt = async () => {
    if (!(await hasNotificationPermission())) {
      await askNotificationPermission();
    }
  };

  const addFromTemplate = (id: string) =>
    run(async () => {
      await addRoutineFromTemplate(db, id);
      await withPermissionPrompt();
    });

  const addPack = (packId: string) =>
    run(async () => {
      const r = await addRoutinePack(db, packId);
      await withPermissionPrompt();
      Alert.alert(
        r.added > 0 ? 'Paket eklendi' : 'Zaten ekli',
        r.added > 0
          ? `${r.added} rutin eklendi${r.skipped > 0 ? `, ${r.skipped} tanesi zaten listendeydi` : ''}. Saatleri istediğin zaman değiştirebilirsin.`
          : 'Bu paketteki rutinlerin hepsi listende.'
      );
    });

  const submitEditor = (draft: RoutineDraft) => {
    const editing = editor.routine;
    setEditor({ open: false, routine: null });
    run(async () => {
      const input = { ...draft, days: serializeDays(draft.days) };
      if (editing) {
        await updateRoutine(db, editing.id, input);
      } else {
        await addCustomRoutine(db, input);
        await withPermissionPrompt();
      }
    });
  };

  const confirmRetire = (r: Routine) =>
    Alert.alert('Bir daha yapmayacak mısın?', `"${r.title}" listenden kalkar. Geri alabilirsin.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Evet, bırak', style: 'destructive', onPress: () => run(() => retireRoutine(db, r)) },
    ]);

  const applySuggestion = (b: RoutineBrief) => {
    const s = b.suggestion;
    if (!s) return;
    if (s.kind === 'MOVE_TIME' && s.hour !== undefined) {
      run(() => changeRoutineTime(db, b.routine.id, s.hour as number, s.minute ?? 0));
    } else if (s.kind === 'SHRINK' && s.minutes) {
      run(() => changeRoutineDuration(db, b.routine.id, s.minutes as number));
    } else if (s.kind === 'RETIRE') {
      confirmRetire(b.routine);
    }
  };

  const suggestionLabel = (b: RoutineBrief): string | null => {
    const s = b.suggestion;
    if (!s) return null;
    if (s.kind === 'MOVE_TIME' && s.hour !== undefined) {
      return `Saati ${String(s.hour).padStart(2, '0')}:${String(s.minute ?? 0).padStart(2, '0')} yap`;
    }
    if (s.kind === 'SHRINK' && s.minutes) return `${s.minutes} dakikaya indir`;
    if (s.kind === 'RETIRE') return 'Bırak';
    return null;
  };

  // Ekran arka planda kalırsa veri bayatlamasın.
  useEffect(() => {
    const id = setInterval(() => load().catch(() => undefined), 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Rutinlerim</Text>
        <Text style={styles.sub}>
          Seçtiğin rutinleri belirlediğin saatte "bugün yapacak mısın?" diye sorarım. Cevapların
          (yapacağım, sonra, bugün değil, bir daha yapmam) düzenini anlamama yardım eder; istediğin zaman
          saati ya da süreyi değiştirebilirsin.
        </Text>

        {!notifOk && (
          <Pressable
            onPress={async () => {
              await askNotificationPermission();
              load().catch(() => undefined);
            }}
            style={styles.notice}
          >
            <Text style={styles.noticeTitle}>Hatırlatma bildirimleri kapalı</Text>
            <Text style={styles.noticeText}>
              Rutin saati gelince haber verebilmem için dokun ve bildirimlere izin ver.
            </Text>
          </Pressable>
        )}

        {briefs.length > 0 && (
          <Text style={styles.progress}>
            Bugün: {progress.done} yapıldı · {progress.open} açık · {progress.skipped} bugünlük kapalı
          </Text>
        )}

        <Text style={styles.section}>Aktif rutinler</Text>
        {briefs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Henüz rutin yok. Aşağıdaki örneklerden birini ekleyebilirsin.</Text>
          </View>
        ) : (
          briefs.map((b) => {
            const s = b.stats;
            const label = suggestionLabel(b);
            return (
              <View key={b.routine.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: routineColor(b.routine) }]}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardIcon}>{routineIcon(b.routine)}</Text>
                  <Text style={styles.cardTitle}>{b.routine.title}</Text>
                  <Text style={[styles.cardTime, { color: routineColor(b.routine) }]}>{formatAskTime(b.routine)}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {routineDaysLabel(b.routine)} · {b.routine.estimatedDuration} dk ·{' '}
                  {s.closedDays > 0
                    ? `son 14 günde ${s.doneDays}/${s.closedDays} gün yaptın`
                    : 'henüz veri yok'}
                  {s.streak >= 2 ? ` · ${s.streak} gün seri` : ''}
                </Text>
                {b.state === 'OFF' && <Text style={styles.cardMeta}>Bugün planlı değil, sorulmaz.</Text>}
                {b.suggestion && (
                  <View style={styles.suggestion}>
                    <Text style={styles.suggestionText}>{b.suggestion.text}</Text>
                    {label && (
                      <Pressable
                        disabled={busy}
                        onPress={() => applySuggestion(b)}
                        style={[styles.suggestionBtn, busy && { opacity: 0.5 }]}
                      >
                        <Text style={styles.suggestionBtnText}>{label}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
                <View style={styles.actions}>
                  <Pressable onPress={() => setEditor({ open: true, routine: b.routine })} hitSlop={6}>
                    <Text style={styles.action}>Düzenle</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmRetire(b.routine)} hitSlop={6}>
                    <Text style={[styles.action, { color: colors.danger }]}>Bir daha yapmam</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        <Pressable onPress={() => setEditor({ open: true, routine: null })} style={styles.customBtn}>
          <Text style={styles.customBtnText}>+ Kendi rutinimi ekle</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/habits')} style={styles.calendarBtn}>
          <Text style={styles.calendarBtnText}>📅 Alışkanlık takvimi ve ruh hali ›</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/quiz')} style={styles.calendarBtn}>
          <Text style={styles.calendarBtnText}>🧭 Rutin tarzı testi (sana uygun paketi bul) ›</Text>
        </Pressable>

        <Text style={styles.section}>Hazır paketler</Text>
        {ROUTINE_PACKS.map((p) => {
          const missing = p.items.filter((i) => !activeTemplateIds.has(i.templateId)).length;
          return (
            <View key={p.id} style={styles.template}>
              <Text style={styles.packIcon}>{p.icon}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.templateTitle}>{p.title}</Text>
                <Text style={styles.templateWhy}>{p.about}</Text>
                <Text style={styles.templateMeta}>{p.items.length} rutin</Text>
              </View>
              <Pressable
                disabled={missing === 0 || busy}
                onPress={() => addPack(p.id)}
                style={[styles.addBtn, missing === 0 && styles.addBtnDone]}
              >
                <Text style={[styles.addBtnText, missing === 0 && { color: colors.textMuted }]}>
                  {missing === 0 ? 'Eklendi' : 'Hepsini ekle'}
                </Text>
              </Pressable>
            </View>
          );
        })}

        <Text style={styles.section}>Örnek rutinler</Text>
        {CATEGORY_ORDER.map((cat) => (
          <View key={cat} style={{ gap: spacing.sm }}>
            <Text style={styles.category}>{CATEGORY_LABEL[cat]}</Text>
            {ROUTINE_TEMPLATES.filter((t) => t.category === cat).map((t) => {
              const added = activeTemplateIds.has(t.id);
              return (
                <View key={t.id} style={styles.template}>
                  <Text style={styles.packIcon}>{t.icon}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.templateTitle}>{t.title}</Text>
                    <Text style={styles.templateMeta}>
                      {String(t.askHour).padStart(2, '0')}:{String(t.askMinute).padStart(2, '0')} ·{' '}
                      {t.estimatedDuration} dk{t.days ? ` · ${daysLabel(t.days)}` : ''}
                    </Text>
                    <Text style={styles.templateWhy}>{t.why}</Text>
                  </View>
                  <Pressable
                    disabled={added || busy}
                    onPress={() => addFromTemplate(t.id)}
                    style={[styles.addBtn, added && styles.addBtnDone]}
                  >
                    <Text style={[styles.addBtnText, added && { color: colors.textMuted }]}>
                      {added ? 'Eklendi' : 'Ekle'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}

        {retired.length > 0 && (
          <>
            <Text style={styles.section}>Bıraktıkların</Text>
            {retired.map((r) => (
              <View key={r.id} style={styles.template}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateTitle}>{r.title}</Text>
                  <Text style={styles.templateMeta}>Sana bir daha sorulmaz</Text>
                </View>
                <Pressable
                  disabled={busy}
                  onPress={() => run(() => restoreRoutine(db, r.id))}
                  style={styles.addBtn}
                >
                  <Text style={styles.addBtnText}>Geri al</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <RoutineEditor
        visible={editor.open}
        routine={editor.routine}
        onClose={() => setEditor({ open: false, routine: null })}
        onSubmit={submitEditor}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  back: { color: colors.kronos, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  notice: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  noticeTitle: { color: colors.warning, fontSize: 14, fontWeight: '700' },
  noticeText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  progress: { color: colors.aura, fontSize: 13, fontWeight: '600' },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  category: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: spacing.sm },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  cardIcon: { fontSize: 22 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  cardTime: { color: colors.aura, fontSize: 14, fontWeight: '800' },
  cardMeta: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  suggestion: {
    backgroundColor: colors.auraSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  suggestionText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  suggestionBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  suggestionBtnText: { color: colors.bg, fontSize: 13, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.xs },
  action: { color: colors.kronos, fontSize: 13, fontWeight: '600' },
  calendarBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  calendarBtnText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  packIcon: { fontSize: 26 },
  customBtn: {
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  customBtnText: { color: colors.aura, fontSize: 14, fontWeight: '700' },
  template: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  templateTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  templateMeta: { color: colors.textMuted, fontSize: 12 },
  templateWhy: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  addBtnDone: { borderColor: colors.border },
  addBtnText: { color: colors.aura, fontSize: 13, fontWeight: '700' },
});
