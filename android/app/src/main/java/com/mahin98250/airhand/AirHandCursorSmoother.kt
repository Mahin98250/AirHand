package com.mahin98250.airhand

import android.os.SystemClock
import kotlin.math.hypot
import kotlin.math.pow

/**
 * Screen-space adaptive low-pass filter: suppresses hand tremor, speeds up for intentional sweeps.
 * All methods are synchronized because tracker callbacks and shutdown can happen on different threads.
 */
class AirHandCursorSmoother(private val baseAlpha: Float = 0.22f) {
    private var x = 0f
    private var y = 0f
    private var lastAt = 0L
    private var initialized = false

    @Synchronized
    fun reset() {
        initialized = false
        lastAt = 0L
    }

    @Synchronized
    fun update(targetX: Float, targetY: Float, nowMs: Long = SystemClock.uptimeMillis()): Pair<Float, Float> {
        if (!targetX.isFinite() || !targetY.isFinite()) return if (initialized) x to y else 0f to 0f
        if (!initialized) {
            x = targetX
            y = targetY
            lastAt = nowMs
            initialized = true
            return x to y
        }
        val elapsed = (nowMs - lastAt).coerceIn(1L, 100L).toFloat()
        lastAt = nowMs
        val dx = targetX - x
        val dy = targetY - y
        val delta = hypot(dx, dy)
        if (delta <= 1.5f) return x to y

        val speed = delta / elapsed * 1000f
        val targetAlpha = when {
            speed > 1600f || delta > 300f -> 0.72f
            speed > 600f || delta > 100f -> 0.44f
            else -> baseAlpha.coerceIn(0.08f, 0.55f)
        }.coerceIn(0.08f, 0.78f)
        val factor = (1f - (1f - targetAlpha).toDouble().pow(elapsed / 16.67)).toFloat()
        x += dx * factor
        y += dy * factor
        return x to y
    }
}
