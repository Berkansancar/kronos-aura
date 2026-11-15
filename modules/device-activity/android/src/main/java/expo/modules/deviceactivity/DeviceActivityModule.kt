package expo.modules.deviceactivity

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val EVENT_RESUMED = 1
private const val EVENT_PAUSED = 2
private const val EVENT_SCREEN_ON = 15
private const val EVENT_SCREEN_OFF = 16
private const val EVENT_KEYGUARD_SHOWN = 17

class DeviceActivityModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DeviceActivity")

    Function("hasUsageAccess") { hasUsageAccess() }
    Function("openUsageAccessSettings") { openSettings(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
    AsyncFunction("getUsageSummary") { startMs: Double, endMs: Double ->
      usageSummary(startMs.toLong(), endMs.toLong())
    }

    AsyncFunction("getScreenSessions") { startMs: Double, endMs: Double ->
      screenSessions(startMs.toLong(), endMs.toLong())
    }

    Function("hasStepSensor") { hasStepSensor() }
    Function("getTodaySteps") { StepStore.todaySteps(ctx) }
    Function("startTracking") { startTracking() }
    Function("stopTracking") { stopTracking() }
    Function("isTracking") { StepTrackingService.running }

    Function("isIgnoringBatteryOptimizations") { isIgnoringBattery() }
    Function("requestIgnoreBatteryOptimizations") { requestIgnoreBattery() }
    Function("openBatterySettings") {
      openSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }
    Function("getManufacturer") { Build.MANUFACTURER.toString() }
  }

  // ───────────── Ekran suresi ─────────────

  private fun hasUsageAccess(): Boolean {
    val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode =
      if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
      } else {
        @Suppress("DEPRECATION")
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
      }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun labelOf(pm: PackageManager, pkg: String): String {
    return try {
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
      pkg
    }
  }

  /** [start, end] araligindaki on plan (ekranda acik) uygulama surelerini ve toplam ekran suresini hesaplar. */
  private fun usageSummary(start: Long, end: Long): Map<String, Any> {
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(start, end)
    val ev = UsageEvents.Event()
    val perPkg = HashMap<String, Long>()
    var curPkg: String? = null
    var curStart = 0L
    var screenOn = false
    var screenStart = 0L
    var screenTotal = 0L

    fun close(t: Long) {
      val p = curPkg
      if (p != null) {
        val d = t - curStart
        if (d > 0L) perPkg[p] = (perPkg[p] ?: 0L) + d
        curPkg = null
      }
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(ev)
      val t = ev.timeStamp
      val p: String = ev.packageName ?: ""
      when (ev.eventType) {
        EVENT_RESUMED -> {
          if (p.isNotEmpty()) {
            if (curPkg != null && curPkg != p) close(t)
            if (curPkg == null) {
              curPkg = p
              curStart = t
            }
          }
        }
        EVENT_PAUSED -> {
          if (curPkg == p) close(t)
        }
        EVENT_SCREEN_ON -> {
          if (!screenOn) {
            screenOn = true
            screenStart = t
          }
        }
        EVENT_SCREEN_OFF -> {
          close(t)
          if (screenOn) {
            screenTotal += t - screenStart
            screenOn = false
          }
        }
        EVENT_KEYGUARD_SHOWN -> {
          close(t)
        }
      }
    }
    if (curPkg != null) close(end)
    if (screenOn) screenTotal += end - screenStart

    val appSum = perPkg.values.sum()
    val totalMs = maxOf(screenTotal, appSum)

    val pm = ctx.packageManager
    val apps =
      perPkg.entries
        .filter { it.value >= 30_000L && pm.getLaunchIntentForPackage(it.key) != null }
        .sortedByDescending { it.value }
        .take(15)
        .map {
          mapOf<String, Any>(
            "package" to it.key,
            "label" to labelOf(pm, it.key),
            "ms" to it.value.toDouble()
          )
        }

    return mapOf<String, Any>("screenMs" to totalMs.toDouble(), "apps" to apps)
  }

  /** Ekranin acik kaldigi araliklar (uyku tahmini icin). Her oge: { on, off } (ms). */
  private fun screenSessions(start: Long, end: Long): List<Map<String, Any>> {
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(start, end)
    val ev = UsageEvents.Event()
    val out = ArrayList<Map<String, Any>>()
    var onAt = -1L
    while (events.hasNextEvent()) {
      events.getNextEvent(ev)
      val t = ev.timeStamp
      when (ev.eventType) {
        EVENT_SCREEN_ON -> {
          if (onAt < 0L) {
            onAt = t
          }
        }
        EVENT_SCREEN_OFF -> {
          if (onAt >= 0L) {
            out.add(mapOf<String, Any>("on" to onAt.toDouble(), "off" to t.toDouble()))
            onAt = -1L
          } else {
            // Pencere basinda ekran zaten aciksa
            out.add(mapOf<String, Any>("on" to start.toDouble(), "off" to t.toDouble()))
          }
        }
      }
    }
    if (onAt >= 0L) {
      out.add(mapOf<String, Any>("on" to onAt.toDouble(), "off" to end.toDouble()))
    }
    return out
  }

  // ───────────── Adim ve arka plan takibi ─────────────

  private fun hasStepSensor(): Boolean {
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    return sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
  }

  private fun startTracking(): Boolean {
    return try {
      ctx.getSharedPreferences(StepStore.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(StepStore.KEY_TRACKING, true)
        .apply()
      val svc = Intent(ctx, StepTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc) else ctx.startService(svc)
      true
    } catch (e: Throwable) {
      false
    }
  }

  private fun stopTracking(): Boolean {
    return try {
      ctx.getSharedPreferences(StepStore.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(StepStore.KEY_TRACKING, false)
        .apply()
      ctx.stopService(Intent(ctx, StepTrackingService::class.java))
      true
    } catch (e: Throwable) {
      false
    }
  }

  // ───────────── Pil kisitlamasi ─────────────

  private fun isIgnoringBattery(): Boolean {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isIgnoringBatteryOptimizations(ctx.packageName)
  }

  private fun requestIgnoreBattery(): Boolean {
    val direct =
      Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName))
    if (openSettings(direct)) return true
    return openSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
  }

  private fun openSettings(intent: Intent): Boolean {
    return try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      true
    } catch (e: Exception) {
      false
    }
  }
}
