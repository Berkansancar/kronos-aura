// Ortak tipler. Uygulamanın her katmanı (veritabanı, zamanlayıcı, koçlar, arayüz) bunları kullanır.

export type Chronotype = 'MORNING' | 'NIGHT' | 'BALANCED';
export type CognitiveWeight = 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'POSTPONED';
export type EnergyState = 'HIGH' | 'EXHAUSTED' | 'DISTRACTED';
export type CoachId = 'KRONOS' | 'AURA';

export interface UserProfile {
  id: string;
  chronotype: Chronotype;
  /** Tepe enerji penceresinin başlangıcı (0-23) */
  peakStartHour: number;
  /** Tepe enerji penceresinin bitişi (1-24, başlangıçtan büyük) */
  peakEndHour: number;
}

export interface Task {
  id: string;
  title: string;
  /** dakika */
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  status: TaskStatus;
  /** ISO-8601 (UTC) */
  createdAt: string;
  /** Görev "Başla" ile başlatıldığında dolar; gerçek süreyi hesaplamak için gerekir. */
  startedAt: string | null;
  /** Bir rutinin "Yapacağım" cevabıyla oluştuysa o rutinin id'si. */
  routineId?: string | null;
  /** İş saatlerinde de yapılabilir mi? (false: iş saatinin dışına yerleştirilir) */
  workOk?: boolean;
  /** Minibüste telefonla yapılabilir mi? (yoldayken önerilir; plana etkisi yok) */
  commuteOk?: boolean;
  /** Yapılacağı gün (yyyy-mm-dd); doluysa görev o güne kadar plana girmez. Boş: belirli bir günü yok. */
  plannedDay?: string | null;
}

/** Veritabanındaki TimeBlock satırı. Tarihler ISO-8601 (UTC) metin olarak saklanır. */
export interface TimeBlockRow {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string;
  /** Geçiş tamponu, dakika */
  bufferTime: number;
}

export interface TimeLog {
  id: string;
  /** null = görevden bağımsız "zaman akıp gitti" kaydı (Aura) */
  taskId: string | null;
  /** dakika */
  actualDuration: number;
  energyStateAtCompletion: EnergyState;
  coachNotes: string | null;
  loggedAt: string;
}

/** Zamanlayıcının üretip tükettiği, veritabanından bağımsız blok biçimi. */
export interface PlannedSlot {
  taskId: string;
  startTime: Date;
  endTime: Date;
  /** dakika */
  bufferTime: number;
}

/** Öğrenen süre kalibrasyonu için tek bir gözlem: tahmin vs gerçek. */
export interface DurationSample {
  cognitiveWeight: CognitiveWeight;
  estimatedDuration: number;
  actualDuration: number;
}

/** Koçlarla yapılan sohbetin tek mesajı (telefonda saklanır). */
export interface ChatMessage {
  id: string;
  coach: CoachId;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** Bir günün telefon kullanım özeti (telefonda saklanır). `day` yerel tarihtir: YYYY-MM-DD. */
export interface DailyStat {
  day: string;
  steps: number;
  /** null = ekran süresi okunamadı (Kullanım erişimi izni yok) */
  screenMinutes: number | null;
  topApps: { label: string; minutes: number }[];
  updatedAt: string;
}

/** Koç motorunun kullandığı, bugüne ait kısa aktivite özeti. */
export interface ActivitySummary {
  /** null = adım takibi kapalı */
  steps: number | null;
  /** Adım sayısı gün boyu izlenmiş mi? (Takip öğleden sonra açıldıysa eksik sayılır.) */
  stepsReliable: boolean;
  /** null = ekran süresi okunamıyor */
  screenMinutes: number | null;
  topApps: { label: string; minutes: number }[];
}

// ───────────────────────── Rutinler ─────────────────────────

export type RoutineCategory = 'SAGLIK' | 'ZIHIN' | 'ODAK' | 'DUZEN';
export type RoutineStatus = 'ACTIVE' | 'RETIRED';

/** Her gün tekrarlanan alışkanlık. `askHour:askMinute` uygulamanın "yapacak mısın?" diye sorduğu saattir. */
export interface Routine {
  id: string;
  title: string;
  category: RoutineCategory;
  /** dakika */
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  askHour: number;
  askMinute: number;
  status: RoutineStatus;
  createdAt: string;
  retiredAt: string | null;
  /** Hazır örnekten eklendiyse şablon id'si */
  templateId: string | null;
}

/**
 * ACCEPTED: "Yapacağım"  · DONE: yapıldı · SNOOZED: "Sonra" · SKIPPED: "Bugün değil"
 * RETIRED: "Bir daha yapmam"
 */
export type RoutineOutcome = 'ACCEPTED' | 'DONE' | 'SNOOZED' | 'SKIPPED' | 'RETIRED';

export interface RoutineLog {
  id: string;
  routineId: string;
  /** Yerel gün: YYYY-MM-DD */
  day: string;
  outcome: RoutineOutcome;
  /** ACCEPTED ise plana eklenen görev */
  taskId: string | null;
  /** SNOOZED ise yeniden sorulacak an (ISO) */
  snoozeUntil: string | null;
  loggedAt: string;
}

/** Bir rutinin bugünkü durumu. */
export type RoutineDayState = 'WAITING' | 'DUE' | 'SNOOZED' | 'ACCEPTED' | 'DONE' | 'SKIPPED';

export interface RoutineStats {
  /** Cevap verilen (kapanmış) gün sayısı */
  closedDays: number;
  doneDays: number;
  skippedDays: number;
  snoozeCount: number;
  acceptedNotDone: number;
  /** 0..1 */
  rate: number;
  /** Üst üste yapılan gün sayısı */
  streak: number;
  /** En sık yapıldığı saat (en az 3 kayıt gerekir) */
  bestHour: number | null;
}

export type RoutineSuggestionKind = 'MOVE_TIME' | 'SHRINK' | 'RETIRE' | 'KEEP_GOING';

export interface RoutineSuggestion {
  kind: RoutineSuggestionKind;
  text: string;
  hour?: number;
  minute?: number;
  minutes?: number;
}

/** Koçların ve ana ekranın kullandığı, bir rutinin bugünkü özeti. */
export interface RoutineBrief {
  routine: Routine;
  state: RoutineDayState;
  snoozeUntil: string | null;
  stats: RoutineStats;
  suggestion: RoutineSuggestion | null;
}

// ───────────────────────── Uyku ─────────────────────────

/** Tahmini uyku: telefon ekranının en uzun süre kapalı kaldığı gece aralığı. `day` uyanılan yerel gündür. */
export interface SleepLog {
  day: string;
  bedtime: string;
  wakeTime: string;
  durationMinutes: number;
}

export interface SleepSummary {
  /** Son gecenin tahmini süresi (dk) */
  lastMinutes: number | null;
  lastBedtime: string | null;
  lastWake: string | null;
  /** Son günlerin ortalaması */
  avgMinutes: number | null;
  nights: number;
}

// ───────────────────────── Gün sonu değerlendirmesi ─────────────────────────

/** Gün sonunda önerilen yeni rutin fikri. `templateId` doluysa hazır örnekten gelir. */
export interface RoutineIdea {
  title: string;
  category: RoutineCategory;
  minutes: number;
  hour: number;
  minute: number;
  why: string;
  templateId?: string | null;
}

/** AI: API anahtarıyla, MANUAL: ücretsiz sohbet uygulamasından elle yapıştırılan cevap, RULES: hazır kurallar */
export type ReviewSource = 'AI' | 'FREE' | 'MANUAL' | 'RULES';

/** Ekran süresi yerine yapılabilecek bir şey. TASK: kullanıcının açık işi, IDEA: kısa fikir. */
export interface ScreenAlternative {
  title: string;
  minutes: number;
  why: string;
  kind: 'TASK' | 'IDEA';
}

export interface DayReviewPayload {
  /** Aura: günü yargılamadan yorumlar */
  reflection: string;
  /** Kronos: yarın için kısa strateji */
  tomorrow: string;
  ideas: RoutineIdea[];
  source: ReviewSource;
  /** Aura: zamanın nereye gittiği (kayıt dışı kalan zaman, akıp giden, ekran). Eski kayıtlarda yoktur. */
  timeUse?: string;
  /** "Ekran süren X. Bunun yalnızca Y kadarını ayırsan şunlar sığar:" */
  screenNote?: string;
  screenAlternatives?: ScreenAlternative[];
}

export interface DayReview {
  /** Değerlendirilen günün anahtarı (yyyy-mm-dd) */
  day: string;
  payload: DayReviewPayload;
  createdAt: string;
}


// ───────────────────────── Su ve yemek ─────────────────────────

export type MealKind = 'KAHVALTI' | 'OGLE' | 'AKSAM' | 'ARA' | 'ICECEK';

export interface WaterLog {
  id: string;
  /** yyyy-mm-dd */
  day: string;
  amountMl: number;
  loggedAt: string;
}

export interface MealLog {
  id: string;
  day: string;
  kind: MealKind;
  note: string;
  /** Besin grubu kimlikleri (JSON'dan çözülmüş) */
  groups: string[];
  /** Yaklaşık kalori; bilinmiyorsa null */
  kcal: number | null;
  eatenAt: string;
}

// ───────────────────────── Görev sonuçları ─────────────────────────

/** DONE: Yaptım · NOT_DONE: Yapmadım (bugün yapmamayı seçti) · COULD_NOT: Yapamadım (olmadı) */
export type TaskOutcomeKind = 'DONE' | 'NOT_DONE' | 'COULD_NOT';
/** "Yapamadım" için isteğe bağlı sebep: iş vaktindeydi, enerji yoktu, zaman yetmedi, başka bir şey çıktı */
export type TaskOutcomeReason = 'WORK' | 'ENERGY' | 'TIME' | 'OTHER';

export interface TaskOutcome {
  id: string;
  taskId: string | null;
  title: string;
  /** Mantıksal gün: yyyy-mm-dd (gece 04:00'e kadar önceki gün) */
  day: string;
  outcome: TaskOutcomeKind;
  reason: TaskOutcomeReason | null;
  /** Yaptım ise harcanan dakika */
  minutes: number;
  workOk: boolean;
  /** Ertesi gün plana geri alındı mı */
  carried: boolean;
  loggedAt: string;
}

// ───────────────────────── Gün akışı ve sigara sayacı ─────────────────────────

/** Uyandım · Duş aldım · Minibüse bindim · Dükkana geldim · Dükkandan çıktım · Eve geldim */
export type DayEventKind = 'WAKE' | 'SHOWER' | 'BUS' | 'SHOP_IN' | 'SHOP_OUT' | 'HOME';

export interface DayEvent {
  id: string;
  /** Mantıksal gün: yyyy-mm-dd (gece 04:00'e kadar önceki gün) */
  day: string;
  kind: DayEventKind;
  at: string;
}

export interface SmokeLog {
  id: string;
  day: string;
  at: string;
}

/** PAPER: kalem-kağıt, APP: uygulamada geçen süre (elle), OTHER: dinleme, konuşma, video vb. */
export type StudyKind = 'PAPER' | 'APP' | 'OTHER';

/** Elle eklenen dil çalışması. `day` mantıksal gündür (gece 04:00'e kadar önceki gün). */
export interface StudyLog {
  id: string;
  day: string;
  kind: StudyKind;
  minutes: number;
  loggedAt: string;
}
