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
export type ReviewSource = 'AI' | 'MANUAL' | 'RULES';

export interface DayReviewPayload {
  /** Aura: günü yargılamadan yorumlar */
  reflection: string;
  /** Kronos: yarın için kısa strateji */
  tomorrow: string;
  ideas: RoutineIdea[];
  source: ReviewSource;
}

export interface DayReview {
  /** Değerlendirilen günün anahtarı (yyyy-mm-dd) */
  day: string;
  payload: DayReviewPayload;
  createdAt: string;
}
