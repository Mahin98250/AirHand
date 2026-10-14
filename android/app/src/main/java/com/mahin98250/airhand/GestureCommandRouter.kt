package com.mahin98250.airhand

/**
 * Central safety gate for future camera/gesture integrations.
 * Unknown, low-confidence, or stale detections must never trigger system actions.
 */
object GestureCommandRouter {
    @Volatile var enabled: Boolean = false
    @Volatile var lastDetectionAtMs: Long = 0L

    fun mayDispatch(nowMs: Long = System.currentTimeMillis(), confidence: Float): Boolean {
        return enabled && confidence >= 0.80f && lastDetectionAtMs > 0L &&
            nowMs >= lastDetectionAtMs && nowMs - lastDetectionAtMs <= 250L
    }

    fun stop() {
        enabled = false
        lastDetectionAtMs = 0L
    }
}
