package expo.modules.deviceactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Telefon yeniden acilinca, takip acik birakilmissa servisi tekrar baslatir. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
    val enabled =
      context.getSharedPreferences(StepStore.PREFS, Context.MODE_PRIVATE)
        .getBoolean(StepStore.KEY_TRACKING, false)
    if (!enabled) return
    try {
      val svc = Intent(context, StepTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(svc) else context.startService(svc)
    } catch (e: Throwable) {
      // Bazi telefonlar acilista baslatmaya izin vermez; uygulama acilinca takip yeniden baslar.
    }
  }
}
