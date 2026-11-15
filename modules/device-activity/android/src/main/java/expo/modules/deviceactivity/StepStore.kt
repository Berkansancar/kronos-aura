package expo.modules.deviceactivity

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Gunluk adimlari telefonda (SharedPreferences) tutar. Adim sensoru "telefon acildigindan beri"
 * toplam sayiyi verir; burada gun bazli sayiya cevrilir. Telefon yeniden baslayinca sensor sifirlanir,
 * bu durum da yakalanip o gunun toplami korunur.
 */
object StepStore {
  const val PREFS = "kronos_aura_steps"
  const val KEY_TRACKING = "tracking"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  @Synchronized
  fun record(c: Context, total: Long): Int {
    val p = prefs(c)
    val t = today()
    var day = p.getString("day", "") ?: ""
    var baseline = p.getLong("baseline", -1L)
    var carry = p.getLong("carry", 0L)
    val last = p.getLong("last", -1L)

    if (day != t) {
      // Yeni gun: sayac sifirlanir. Dunku son okumadan beri atilan adimlar bugune yazilir.
      carry = 0L
      baseline = if (last < 0L) total else if (last <= total) last else 0L
      day = t
    } else if (total < last) {
      // Telefon yeniden basladi: o ana kadarki gunluk toplam korunur.
      carry += (last - baseline).coerceAtLeast(0L)
      baseline = 0L
    }

    val steps = (carry + (total - baseline)).coerceAtLeast(0L)
    p.edit()
      .putString("day", day)
      .putLong("baseline", baseline)
      .putLong("carry", carry)
      .putLong("last", total)
      .apply()
    return steps.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
  }

  @Synchronized
  fun todaySteps(c: Context): Int {
    val p = prefs(c)
    val day = p.getString("day", "") ?: ""
    if (day != today()) return 0
    val last = p.getLong("last", -1L)
    val baseline = p.getLong("baseline", -1L)
    val carry = p.getLong("carry", 0L)
    if (last < 0L || baseline < 0L) return 0
    return (carry + last - baseline).coerceAtLeast(0L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
  }
}
