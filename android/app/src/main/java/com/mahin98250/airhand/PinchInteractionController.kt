package com.mahin98250.airhand

import kotlin.math.hypot

internal enum class PinchActionType { TAP, LONG_PRESS }

internal data class PinchAction(
    val type: PinchActionType,
    val x: Float,
    val y: Float,
    val confidence: Float
)

/**
 * Converts a deliberate, steady pinch into either a tap on release or a long press.
 * Movement beyond the drift limit cancels the click; loss of tracking resets the state.
 */
internal class PinchInteractionController(
    private val longPressDelayMs: Long = 550L,
    private val maxDriftDp: Float = 28f,
    private val minimumConfidence: Float = 0.85f
) {
    private var active = false
    private var startedAtMs = 0L
    private var startX = 0f
    private var startY = 0f
    private var startConfidence = 0f
    private var movedTooFar = false
    private var longPressFired = false

    init {
        require(longPressDelayMs > 0L)
        require(maxDriftDp > 0f && maxDriftDp.isFinite())
        require(minimumConfidence in 0f..1f)
    }

    @Synchronized
    fun update(
        isPinching: Boolean,
        x: Float,
        y: Float,
        confidence: Float,
        nowMs: Long,
        density: Float = 1f
    ): PinchAction? {
        if (!active) {
            if (!isPinching || !x.isFinite() || !y.isFinite() ||
                !confidence.isFinite() || confidence < minimumConfidence
            ) return null

            active = true
            startedAtMs = nowMs
            startX = x
            startY = y
            startConfidence = confidence
            movedTooFar = false
            longPressFired = false
            return null
        }

        val elapsed = nowMs - startedAtMs
        if (!isPinching) {
            val result = if (
                elapsed >= 0L && elapsed < longPressDelayMs &&
                !movedTooFar && !longPressFired
            ) PinchAction(PinchActionType.TAP, startX, startY, startConfidence) else null
            reset()
            return result
        }

        if (elapsed < 0L || !x.isFinite() || !y.isFinite() || !density.isFinite() || density <= 0f) {
            reset()
            return null
        }

        if (hypot(x - startX, y - startY) > maxDriftDp * density) {
            movedTooFar = true
        }

        if (!movedTooFar && !longPressFired && elapsed >= longPressDelayMs &&
            confidence.isFinite() && confidence >= minimumConfidence
        ) {
            longPressFired = true
            return PinchAction(PinchActionType.LONG_PRESS, startX, startY, startConfidence)
        }
        return null
    }

    @Synchronized
    fun isActive(): Boolean = active

    @Synchronized
    fun reset() {
        active = false
        startedAtMs = 0L
        startX = 0f
        startY = 0f
        startConfidence = 0f
        movedTooFar = false
        longPressFired = false
    }
}
