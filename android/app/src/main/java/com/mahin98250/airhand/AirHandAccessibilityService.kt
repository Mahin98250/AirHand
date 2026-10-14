package com.mahin98250.airhand

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityEvent

/**
 * Accessibility bridge. It exposes a narrow set of explicit navigation actions;
 * it does not inspect window text or automatically activate controls.
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
        super.onDestroy()
    }

    fun performNavigation(action: NavigationAction): Boolean {
        if (!GestureCommandRouter.enabled) return false
        return when (action) {
            NavigationAction.BACK -> performGlobalAction(GLOBAL_ACTION_BACK)
            NavigationAction.HOME -> performGlobalAction(GLOBAL_ACTION_HOME)
            NavigationAction.NOTIFICATIONS -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            NavigationAction.SCROLL_DOWN -> dispatchSwipe(0.5f, 0.72f, 0.5f, 0.28f)
            NavigationAction.SCROLL_UP -> dispatchSwipe(0.5f, 0.28f, 0.5f, 0.72f)
        }
    }

    private fun dispatchSwipe(x1: Float, y1: Float, x2: Float, y2: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val metrics = resources.displayMetrics
        val path = Path().apply {
            moveTo(metrics.widthPixels * x1, metrics.heightPixels * y1)
            lineTo(metrics.widthPixels * x2, metrics.heightPixels * y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 280)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    enum class NavigationAction { BACK, HOME, NOTIFICATIONS, SCROLL_UP, SCROLL_DOWN }

    companion object {
        @Volatile var instance: AirHandAccessibilityService? = null
            private set
    }
}
