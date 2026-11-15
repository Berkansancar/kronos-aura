package expo.modules.deviceactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import java.util.Locale

/**
 * Arka planda adimlari sayan servis. Bildirim cubugunda kalici ve sessiz bir bildirim gosterir;
 * Android'in uygulamayi kapatmamasi icin bu zorunludur.
 */
class StepTrackingService : Service(), SensorEventListener {
  companion object {
    @Volatile
    var running: Boolean = false
    const val CHANNEL_ID = "kronos_aura_takip"
    const val NOTIFICATION_ID = 4711
  }

  private var sensorManager: SensorManager? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    try {
      val n = buildNotification(StepStore.todaySteps(this))
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
      } else {
        startForeground(NOTIFICATION_ID, n)
      }
    } catch (e: Throwable) {
      stopSelf()
      return
    }

    val sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensorManager = sm
    val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (sensor != null) {
      // Okumalar en fazla 1 dakika biriktirilip toplu gelir: pil dostu.
      sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, 60_000_000)
    }
    running = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    running = false
    try {
      sensorManager?.unregisterListener(this)
    } catch (e: Throwable) {
      // yok say
    }
    super.onDestroy()
  }

  override fun onSensorChanged(event: SensorEvent?) {
    val e = event ?: return
    if (e.values.isEmpty()) return
    val steps = StepStore.record(this, e.values[0].toLong())
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(NOTIFICATION_ID, buildNotification(steps))
    } catch (ex: Throwable) {
      // bildirim guncellenemezse sayim yine de devam eder
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val ch = NotificationChannel(CHANNEL_ID, "Günlük takip", NotificationManager.IMPORTANCE_LOW)
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
  }

  private fun buildNotification(steps: Int): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pi: PendingIntent? =
      if (launch != null) {
        PendingIntent.getActivity(
          this,
          0,
          launch,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
      } else {
        null
      }

    val b =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID)
      else Notification.Builder(this)

    val text = String.format(Locale("tr", "TR"), "Bugün %,d adım", steps)
    b.setContentTitle("Kronos & Aura")
    b.setContentText(text)
    b.setSmallIcon(android.R.drawable.ic_menu_info_details)
    b.setOngoing(true)
    b.setOnlyAlertOnce(true)
    if (Build.VERSION.SDK_INT < 26) {
      @Suppress("DEPRECATION")
      b.setPriority(Notification.PRIORITY_LOW)
    }
    if (pi != null) b.setContentIntent(pi)
    return b.build()
  }
}
