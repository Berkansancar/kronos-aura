/** Günün küçük kendine bakım ipuçları. Gün anahtarına göre her gün aynı ipucu çıkar. Saf mantık. */
export const SELF_CARE_TIPS: string[] = [
  'Bugün bir bardak fazladan su iç. Küçük bir adım yeter.',
  'Gün içinde bir kez omuzlarını geriye aç ve üç derin nefes al.',
  'Telefonu bir süre elinden bırak; pencereden dışarı bak.',
  'Bugün tamamlayacağın tek küçük bir iş seç. Gerisi bonus.',
  'Yürürken adımlarını say ya da sadece çevreni dinle.',
  'Bugün kendine "yeterince iyi yaptım" demeyi dene.',
  'Yemeğini ekrana bakmadan, birkaç dakika sakin ye.',
  'Sevdiğin birine tek cümlelik bir mesaj at.',
  'Akşam yatmadan önce yarın için tek bir şey belirle.',
  'Gözlerini ekrandan ayırıp 20 saniye uzağa bak.',
  'Bugün bir şeye "hayır" dediysen bu, kendine gösterdiğin saygıdır.',
  'Omuz ve boynunu yavaşça çevir; gün boyu biriken yük hafifler.',
  'Bir şeyi mükemmel yapmaya çalışma, başlamak yeterli.',
  'Bugün güldüğün bir anı hatırla.',
  'Kısa bir mola da bir tür ilerlemedir.',
  'Işıkları akşamları biraz kıs; vücut uykuya daha kolay geçer.',
  'Bugünün güzel giden tek bir şeyini yaz.',
  'Bedenin sana ne söylüyor? Bir dakika dinle.',
  'Yapamadığın bir şey için kendine kızmak yerine, yarın için küçük bir ayar yap.',
  'Bugün sana iyi gelen küçük bir şeyi tekrarla.',
  'Bir bardak sıcak içecek ve beş dakika sessizlik güzel bir ara olur.',
  'Zor bir gün de geçer. Bugün sadece nefes almak bile yeter.',
  'Karşılaştırmayı bırak; dünkü kendinle kıyasla.',
  'Çantanı ya da masanı beş dakikada toparla; zihnin de toparlanır.',
  'Bugün bir kişiye teşekkür et.',
  'Merdiven varsa asansör yerine merdiveni dene.',
  'Hedefini küçült: bugün 5 dakika bile sayılır.',
  'Dinlenmek de planın bir parçasıdır.',
  'Bugün sana iyi gelen bir şarkı aç.',
  'Kendine karşı arkadaşına davrandığın gibi davran.',
];

/** Ardışık günlerde ardışık ipuçları çıkar; böylece bir ay boyunca hiçbiri tekrarlanmaz. */
export function tipOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
  if (!Number.isFinite(n)) return SELF_CARE_TIPS[0];
  return SELF_CARE_TIPS[((n % SELF_CARE_TIPS.length) + SELF_CARE_TIPS.length) % SELF_CARE_TIPS.length];
}
