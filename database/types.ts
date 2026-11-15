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
