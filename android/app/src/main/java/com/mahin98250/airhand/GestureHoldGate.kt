package com.mahin98250.airhand

/**
 * Fires once after a pose remains continuously active for the required hold duration.
 * Passing null or changing poses resets the timer, so a held gesture cannot repeat an action.
 */
internal class GestureHoldGate {
    private var activeGesture: String? = null
    private var startedAtMs = 0L
    private var fired = false

    fun update(gesture: String?, nowMs: Long, requiredHoldMs: Long): Boolean {
        require(requiredHoldMs >= 0L) { "Hold duration cannot be negative." }
        if (gesture.isNullOrBlank()) {
            reset()
            return false
        }
        if (gesture != activeGesture) {
            activeGesture = gesture
            startedAtMs = nowMs
            fired = false
            return false
        }
        if (fired || nowMs < startedAtMs || nowMs - startedAtMs < requiredHoldMs) return false
        fired = true
        return true
    }

    fun reset() {
        activeGesture = null
        startedAtMs = 0L
        fired = false
    }
}
