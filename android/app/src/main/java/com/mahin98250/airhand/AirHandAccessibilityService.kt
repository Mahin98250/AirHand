package com.mahin98250.airhand

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import kotlin.math.max

/**
 * Accessibility bridge with a narrow set of gesture actions. It does not inspect window text
 * or search arbitrary UI content. System actions are disabled unless the user starts control.
 */
class AirHandAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        GestureCommandRouter.stop()
        stopService(Intent(this, AirHandCameraService::class.java))
        super.onDestroy()
    }

    /** Dispatch one short tap only when the recent hand detection passes the central safety gate. */
    fun performTapAt(x: Float, y: Float, confidence: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        if (!GestureCommandRouter.mayDispatch(confidence = confidence)) return false

        val metrics = resources.displayMetrics
        val safeX = x.coerceIn(1f, max(1, metrics.widthPixels - 2).toFloat())
        val safeY = y.coerceIn(1f, max(1, metrics.heightPixels - 2).toFloat())
        val path = Path().apply {
            moveTo(safeX, safeY)
            lineTo(safeX + 1f, safeY + 1f)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 65)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    /** Dispatch a press-and-hold at the selected point, using the same confidence/freshness gate as taps. */
    fun performLongPressAt(x: Float, y: Float, confidence: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        if (!GestureCommandRouter.mayDispatch(confidence = confidence)) return false

        val metrics = resources.displayMetrics
        val safeX = x.coerceIn(1f, max(1, metrics.widthPixels - 2).toFloat())
        val safeY = y.coerceIn(1f, max(1, metrics.heightPixels - 2).toFloat())
        val path = Path().apply {
            moveTo(safeX, safeY)
            lineTo(safeX + 1f, safeY + 1f)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, LONG_PRESS_STROKE_MS)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performNavigation(action: NavigationAction, confidence: Float): Boolean {
        if (!GestureCommandRouter.mayDispatchNavigation(confidence = confidence)) return false
        return when (action) {
            NavigationAction.BACK -> performGlobalAction(GLOBAL_ACTION_BACK)
            NavigationAction.HOME -> performGlobalAction(GLOBAL_ACTION_HOME)
            NavigationAction.RECENTS -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            NavigationAction.NOTIFICATIONS -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            NavigationAction.SCROLL_DOWN -> dispatchSwipe(0.5f, 0.72f, 0.5f, 0.28f)
            NavigationAction.SCROLL_UP -> dispatchSwipe(0.5f, 0.28f, 0.5f, 0.72f)
            NavigationAction.SWIPE_LEFT -> dispatchSwipe(0.78f, 0.5f, 0.22f, 0.5f)
            NavigationAction.SWIPE_RIGHT -> dispatchSwipe(0.22f, 0.5f, 0.78f, 0.5f)
        }
    }

    private fun dispatchSwipe(x1: Float, y1: Float, x2: Float, y2: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || !GestureCommandRouter.enabled) return false
        val metrics = resources.displayMetrics
        val path = Path().apply {
            moveTo(metrics.widthPixels * x1, metrics.heightPixels * y1)
            lineTo(metrics.widthPixels * x2, metrics.heightPixels * y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 280)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    enum class NavigationAction { BACK, HOME, RECENTS, NOTIFICATIONS, SCROLL_UP, SCROLL_DOWN, SWIPE_LEFT, SWIPE_RIGHT }

    companion object {
        private const val LONG_PRESS_STROKE_MS = 700L

        @Volatile var instance: AirHandAccessibilityService? = null
            private set
    }
}
