package com.mahin98250.airhand

import kotlin.math.abs

internal enum class OpenPalmAction { SCROLL_UP, SCROLL_DOWN, SWIPE_LEFT, SWIPE_RIGHT }

/**
 * Turns a stable open-palm wrist trajectory into one deliberate scroll or horizontal swipe.
 * Uses normalized camera coordinates, a dominant-axis threshold and a cooldown to suppress tremor.
 */
internal class OpenPalmGestureController(
    private val verticalThreshold: Float = 0.13f,
    private val horizontalThreshold: Float = 0.16f,
    private val cooldownMs: Long = 650L
) {
    private var previousX: Float? = null
    private var previousY: Float? = null
    private var lastActionAtMs = Long.MIN_VALUE

    init {
        require(verticalThreshold > 0f && verticalThreshold.isFinite())
        require(horizontalThreshold > 0f && horizontalThreshold.isFinite())
        require(cooldownMs >= 0L)
    }

    @Synchronized
    fun update(isOpenPalm: Boolean, wristX: Float, wristY: Float, nowMs: Long): OpenPalmAction? {
        if (!isOpenPalm || !wristX.isFinite() || !wristY.isFinite() ||
            wristX !in 0f..1f || wristY !in 0f..1f
        ) {
            previousX = null
            previousY = null
            return null
        }

        val oldX = previousX
        val oldY = previousY
        if (oldX == null || oldY == null) {
            previousX = wristX
            previousY = wristY
            return null
        }

        val deltaX = wristX - oldX
        val deltaY = wristY - oldY
        if (nowMs < lastActionAtMs || nowMs - lastActionAtMs < cooldownMs) return null

        val action = when {
            abs(deltaX) >= horizontalThreshold && abs(deltaX) > abs(deltaY) ->
                if (deltaX < 0f) OpenPalmAction.SWIPE_LEFT else OpenPalmAction.SWIPE_RIGHT
            abs(deltaY) >= verticalThreshold ->
                if (deltaY < 0f) OpenPalmAction.SCROLL_DOWN else OpenPalmAction.SCROLL_UP
            else -> null
        }

        if (action != null) {
            previousX = wristX
            previousY = wristY
            lastActionAtMs = nowMs
        }
        return action
    }

    @Synchronized
    fun reset() {
        previousX = null
        previousY = null
        lastActionAtMs = Long.MIN_VALUE
    }
}
