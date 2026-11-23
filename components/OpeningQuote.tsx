import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, spacing } from '../constants/theme';
import { formatDayTitle } from '../services/format';
import { getOpeningEnabled, loadNextQuote } from '../services/quoteStore';
import { displayMs, greetingFor, quoteKind, shouldShowOnResume, type Quote } from '../services/quotes';

const LOGO = require('../assets/adaptive-icon.png');

const hideNativeSplash = () => {
  SplashScreen.hideAsync().catch(() => undefined);
};

/**
 * Açılış ekranı: uygulama her açıldığında (ve 20 dakikadan uzun süre arka plandaysa dönüşte) farklı, anlamlı bir söz.
 * Telefonun beyaz açılış penceresinin yerine koyu zemin gelir; söz bunun üstünde yavaşça belirir. Dokununca ya da
 * süre dolunca ana ekrana geçilir. Ayarlar > Açılış sözü ile kapatılabilir.
 */
export function OpeningQuote() {
  const db = useSQLiteContext();
  const [shown, setShown] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [now, setNow] = useState(() => new Date());
  const overlay = useRef(new Animated.Value(1)).current;
  const textIn = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awayAt = useRef<number | null>(null);
  const live = useRef(true);

  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    Animated.timing(overlay, { toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
      if (live.current) setShown(false);
    });
  }, [overlay]);

  const start = useCallback(async () => {
    try {
      if (!(await getOpeningEnabled(db))) {
        if (live.current) setShown(false);
        hideNativeSplash();
        return;
      }
      const q = await loadNextQuote(db);
      if (!live.current) return;
      setNow(new Date());
      setQuote(q);
      setShown(true);
      overlay.setValue(1);
      textIn.setValue(0);
      bar.setValue(1);
      const ms = displayMs(q.text);
      Animated.timing(textIn, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Animated.timing(bar, { toValue: 0, duration: ms, easing: Easing.linear, useNativeDriver: false }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(finish, ms);
    } catch {
      // Söz yüklenemezse ana ekran doğrudan açılır
      if (live.current) setShown(false);
      hideNativeSplash();
    }
  }, [bar, db, finish, overlay, textIn]);

  useEffect(() => {
    live.current = true;
    void start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') awayAt.current = Date.now();
      else if (state === 'active' && awayAt.current !== null) {
        const away = Date.now() - awayAt.current;
        awayAt.current = null;
        if (shouldShowOnResume(away)) void start();
      }
    });
    return () => {
      live.current = false;
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [start]);

  // Söz ekranındayken geri tuşu uygulamayı kapatmak yerine sözü geçer
  useEffect(() => {
    if (!shown) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish();
      return true;
    });
    return () => sub.remove();
  }, [shown, finish]);

  if (!shown) return null;

  const accent = quote ? { kronos: colors.kronos, aura: colors.aura, bilge: colors.text, atasozu: colors.textMuted }[quoteKind(quote)] : colors.textMuted;

  return (
    <Animated.View style={[styles.overlay, { opacity: overlay }]} onLayout={hideNativeSplash}>
      <Pressable
        style={styles.fill}
        onPress={finish}
        accessibilityRole="button"
        accessibilityLabel={quote ? `${quote.text} ${quote.author}. Geçmek için dokun` : 'Açılış ekranı'}
      >
        <View style={styles.top}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.greet}>{greetingFor(now.getHours())}</Text>
          <Text style={styles.date}>{formatDayTitle(now)}</Text>
        </View>

        {quote && (
          <Animated.View style={[styles.center, { opacity: textIn, transform: [{ translateY: textIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
            <Text style={[styles.mark, { color: colors.aura }]}>“</Text>
            <Text style={styles.quote}>{quote.text}</Text>
            <Text style={[styles.author, { color: accent }]}>— {quote.author}</Text>
          </Animated.View>
        )}

        <View style={styles.bottom}>
          <View style={styles.track}>
            <Animated.View style={[styles.fillBar, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
          <Text style={styles.skip}>Geçmek için dokun</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 100, elevation: 100 },
  fill: { flex: 1, paddingHorizontal: spacing.xl + 8, paddingTop: 56, paddingBottom: 48, justifyContent: 'space-between' },
  top: { alignItems: 'center', gap: 4 },
  logo: { width: 120, height: 120 },
  greet: { color: colors.text, fontSize: 18, fontWeight: '700' },
  date: { color: colors.textMuted, fontSize: 13 },
  center: { gap: spacing.sm },
  mark: { fontSize: 64, lineHeight: 64, fontWeight: '800', marginBottom: -12 },
  quote: { color: colors.text, fontSize: 26, lineHeight: 37, fontWeight: '700' },
  author: { fontSize: 15, fontWeight: '700', marginTop: spacing.sm },
  bottom: { alignItems: 'center', gap: spacing.sm },
  track: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fillBar: { height: 3, backgroundColor: colors.aura },
  skip: { color: colors.textMuted, fontSize: 12 },
});
