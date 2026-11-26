import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { dayKey, parseDayKey } from '../services/activityLogic';
import { formatClock, formatDayTitle, formatDuration } from '../services/format';
import {
  clearLocationData,
  computeDay,
  deletePlace,
  isLocationOn,
  isLocationShared,
  listLocationDays,
  listPlaces,
  loadPointsForDay,
  rollupLocation,
  setLocationShared,
  type Place,
} from '../services/location';
import {
  STATE_LABELS,
  barSegments,
  dayIntervals,
  dayWindow,
  hasLocationRecord,
  summaryText,
  type BarSegment,
  type DayLocationSummary,
  type LocState,
} from '../services/locationLogic';
import {
  getPermissionState,
  isTaskRunning,
  locationAvailable,
  saveHere,
  screenSessions,
  startLocationTracking,
  stopLocationTracking,
  type LocationPermissionState,
} from '../services/locationTracking';

const STATE_COLORS: Record<LocState | 'NONE', string> = {
  HOME: colors.aura,
  ROAD: colors.kronos,
  STOP: colors.warning,
  WORK: '#C58CF5',
  NONE: colors.border,
};

interface ScreenData {
  places: Place[];
  on: boolean;
  shared: boolean;
  perm: LocationPermissionState;
  running: boolean;
  today: DayLocationSummary;
  bar: BarSegment[];
  barFrom: number;
  barTo: number;
  history: DayLocationSummary[];
}

export default function LocationScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [data, setData] = useState<ScreenData | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [workName, setWorkName] = useState('Dükkan');

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const today = dayKey(now);
      await rollupLocation(db, now, screenSessions).catch(() => 0);
      const [places, on, shared, perm, running, summary, points] = await Promise.all([
        listPlaces(db),
        isLocationOn(db),
        isLocationShared(db),
        getPermissionState(),
        isTaskRunning(),
        computeDay(db, today, now, screenSessions),
        loadPointsForDay(db, today),
      ]);
      const win = dayWindow(today);
      const to = Math.min(win.end, now.getTime());
      const intervals = dayIntervals(today, points, places, now.getTime());
      const from = parseDayKey(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)));
      const history = (await listLocationDays(db, dayKey(from), today)).filter((d) => d.day !== today).reverse();
      setData({ places, on, shared, perm, running, today: summary, bar: barSegments(intervals, win.start, to), barFrom: win.start, barTo: to, history });
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await startLocationTracking(db);
      if (!r.ok) setNote(r.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopLocationTracking(db);
      setNote(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveAs = async (kind: 'HOME' | 'WORK') => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await saveHere(db, kind, kind === 'HOME' ? 'Ev' : workName);
      if (!r.ok) setNote(r.error);
      else setNote(kind === 'HOME' ? 'Ev noktası kaydedildi.' : `"${r.place.name}" iş noktası olarak kaydedildi.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removePlace = (p: Place) => {
    Alert.alert(`"${p.name}" silinsin mi?`, 'Eski günlerin dakika toplamları değişmez.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await deletePlace(db, p.id);
          await load();
        },
      },
    ]);
  };

  const toggleShared = async (v: boolean) => {
    await setLocationShared(db, v);
    await load();
  };

  const wipe = () => {
    Alert.alert('Tüm konum verisi silinsin mi?', 'Kayıtlı yerler, ham konum örnekleri ve günlük dakika toplamları silinir. Bu geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Hepsini sil',
        style: 'destructive',
        onPress: async () => {
          await stopLocationTracking(db);
          await clearLocationData(db);
          setNote('Konum verisi silindi.');
          await load();
        },
      },
    ]);
  };

  const homes = data?.places.filter((p) => p.kind === 'HOME') ?? [];
  const works = data?.places.filter((p) => p.kind === 'WORK') ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Gün haritası</Text>
        <Text style={styles.sub}>
          Evde, yolda ve durakta kaç dakika geçirdiğini telefon kendisi hesaplar. Koordinatlar yalnızca telefonda kalır.
        </Text>

        {!data ? (
          <ActivityIndicator color={colors.aura} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            {/* Takip */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Konum takibi</Text>
              {!locationAvailable ? (
                <Text style={styles.muted}>Konum takibi yalnızca Android telefonda çalışır.</Text>
              ) : data.on ? (
                <>
                  <Text style={styles.body}>
                    {data.running ? 'Açık: arka planda konum örneği alınıyor.' : 'Açık bırakıldı ama şu an çalışmıyor; uygulamayı yeniden açınca devam eder.'}
                  </Text>
                  {!data.perm.background && (
                    <Text style={styles.warn}>
                      Konum izni "Her zaman izin ver" olmalı: Ayarlar &gt; Uygulamalar &gt; Kronos &amp; Aura &gt; İzinler &gt; Konum.
                    </Text>
                  )}
                  <Pressable onPress={turnOff} style={styles.ghost} disabled={busy}>
                    <Text style={styles.ghostText}>Takibi kapat</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.muted}>
                    Pil dostu çalışır: dakikada en çok bir örnek alınır, telefon uyku modunda ve durağansa Android zaten vermez. Telefonun bildirim
                    çubuğunda küçük bir "Kronos &amp; Aura" bildirimi durur; bu Android'in kuralıdır.
                  </Text>
                  <Pressable onPress={turnOn} style={styles.primary} disabled={busy}>
                    <Text style={styles.primaryText}>{busy ? 'Bekle…' : 'Gün haritasını aç'}</Text>
                  </Pressable>
                </>
              )}
              {note && <Text style={styles.note}>{note}</Text>}
            </View>

            {/* Yerler */}
            <Text style={styles.section}>Yerler</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ev</Text>
              <Text style={styles.muted}>Her gün eve döneceğin için ev, günün çıpasıdır: çıkış, dışarıda geçen süre ve dönüş buradan hesaplanır.</Text>
              {homes.map((p) => (
                <PlaceRow key={p.id} place={p} onDelete={() => removePlace(p)} />
              ))}
              <Pressable onPress={() => saveAs('HOME')} style={homes.length === 0 ? styles.primary : styles.ghost} disabled={busy}>
                <Text style={homes.length === 0 ? styles.primaryText : styles.ghostText}>Şu an evdeyim, evi kaydet</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>İş noktaları (isteğe bağlı)</Text>
              <Text style={styles.muted}>
                Dükkan değişirse yenisini ekle, eskisini silmen gerekmez. Hiç kaydetmezsen dışarıdaki duruşlar "Durakta" sayılır; dükkana uğramadığın gün
                yargılanmaz, yalnızca dakikalar yazılır.
              </Text>
              {works.map((p) => (
                <PlaceRow key={p.id} place={p} onDelete={() => removePlace(p)} />
              ))}
              <TextInput
                value={workName}
                onChangeText={setWorkName}
                placeholder="Adı (ör. Dükkan, Depo)"
                placeholderTextColor={colors.textMuted}
                maxLength={24}
                style={styles.input}
              />
              <Pressable onPress={() => saveAs('WORK')} style={styles.ghost} disabled={busy}>
                <Text style={styles.ghostText}>Buradayım, iş noktası olarak kaydet</Text>
              </Pressable>
            </View>

            {/* Bugün */}
            <Text style={styles.section}>Bugün</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{formatDayTitle(new Date())}</Text>
              {!hasLocationRecord(data.today) ? (
                <Text style={styles.muted}>
                  {data.on ? 'Henüz yeterli örnek yok. Telefon yol alınca ve gün ilerledikçe dolar.' : 'Takibi açınca bugünün haritası burada görünür.'}
                </Text>
              ) : (
                <>
                  <View style={styles.bar}>
                    {data.bar.map((s, i) => (
                      <View key={i} style={{ flex: Math.max(1, s.to - s.from), backgroundColor: STATE_COLORS[s.state] }} />
                    ))}
                  </View>
                  <View style={styles.axis}>
                    {['00', '06', '12', '18', '24'].map((h) => (
                      <Text key={h} style={styles.axisText}>
                        {h}
                      </Text>
                    ))}
                  </View>
                  <Legend s={data.today} />
                  {data.today.leftHome && (
                    <Text style={styles.body}>
                      Evden çıkış {data.today.leftHome}
                      {data.today.backHome ? `, eve dönüş ${data.today.backHome}` : ''}
                    </Text>
                  )}
                  <ScreenLine s={data.today} />
                  <Text style={styles.hint}>
                    Dakikalar tahmindir: örnekler arası boşluk aynı yerde sayılır. Aralıkları bilinmeyen süreler çubukta gri görünür (
                    {formatClock(new Date(data.barFrom))}–{formatClock(new Date(data.barTo))}).
                  </Text>
                </>
              )}
            </View>

            {/* Son günler */}
            {data.history.length > 0 && (
              <>
                <Text style={styles.section}>Son günler</Text>
                <View style={styles.card}>
                  {data.history.map((d) => (
                    <View key={d.day} style={styles.histRow}>
                      <Text style={styles.histDay}>{formatDayTitle(parseDayKey(d.day))}</Text>
                      <Text style={styles.histText}>{summaryText(d) || 'Kayıt yok'}</Text>
                      {d.leftHome && (
                        <Text style={styles.hint}>
                          Çıkış {d.leftHome}
                          {d.backHome ? ` · dönüş ${d.backHome}` : ''}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Gizlilik */}
            <Text style={styles.section}>Gizlilik</Text>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={[styles.body, { flex: 1 }]}>Dakika toplamlarını gün sonu analizine ekle</Text>
                <Switch value={data.shared} onValueChange={toggleShared} thumbColor={data.shared ? colors.aura : colors.textMuted} />
              </View>
              <Text style={styles.hint}>
                Yapay zekâya yalnızca "evde 6 sa, yolda 9 sa" gibi dakika toplamları ve çıkış-dönüş saatleri gider. Koordinat, adres ve yer adı hiçbir zaman gitmez.
                Ham konum örnekleri 3 gün sonra silinir; kayıtlı yerler ve ham örnekler yedeğe girmez.
              </Text>
              <Pressable onPress={wipe} style={styles.dangerBtn}>
                <Text style={styles.dangerText}>Tüm konum verisini sil</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlaceRow({ place, onDelete }: { place: Place; onDelete: () => void }) {
  return (
    <View style={styles.placeRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{place.name}</Text>
        <Text style={styles.hint}>Yarıçap {place.radiusM} m</Text>
      </View>
      <Pressable onPress={onDelete} hitSlop={8}>
        <Text style={styles.delete}>Sil</Text>
      </Pressable>
    </View>
  );
}

function Legend({ s }: { s: DayLocationSummary }) {
  const rows: { state: LocState; min: number }[] = [
    { state: 'HOME', min: s.homeMin },
    { state: 'ROAD', min: s.roadMin },
    { state: 'STOP', min: s.stopMin },
  ];
  if (s.workMin !== null) rows.push({ state: 'WORK', min: s.workMin });
  return (
    <View style={{ gap: 6 }}>
      {rows.map((r) => (
        <View key={r.state} style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: STATE_COLORS[r.state] }]} />
          <Text style={[styles.body, { flex: 1 }]}>{STATE_LABELS[r.state]}</Text>
          <Text style={styles.time}>{formatDuration(r.min)}</Text>
        </View>
      ))}
    </View>
  );
}

function ScreenLine({ s }: { s: DayLocationSummary }) {
  if (s.screenHomeMin === null || s.screenRoadMin === null || s.screenOutMin === null) {
    return <Text style={styles.hint}>Konuma göre ekran süresi için Kullanım erişimi gerekir (Aktivite ekranından açılır).</Text>;
  }
  return (
    <Text style={styles.body}>
      Ekran açık: evde {formatDuration(s.screenHomeMin)}, yolda {formatDuration(s.screenRoadMin)}, duraklarda {formatDuration(s.screenOutMin)}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  note: { color: colors.aura, fontSize: 13, lineHeight: 19 },
  primary: { backgroundColor: colors.aura, borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  ghost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center' },
  ghostText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  dangerBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center' },
  dangerText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  delete: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  bar: { flexDirection: 'row', height: 20, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.border },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: colors.textMuted, fontSize: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  time: { color: colors.text, fontSize: 14, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  histRow: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  histDay: { color: colors.text, fontSize: 13, fontWeight: '700' },
  histText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
