package com.mahin98250.airhand

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureHoldGateTest {
    @Test
    fun actionFiresOnlyAfterTheWholeHoldAndOnlyOnce() {
        val gate = GestureHoldGate()
        assertFalse(gate.update("Peace", 1_000L, 1_000L))
        assertFalse(gate.update("Peace", 1_999L, 1_000L))
        assertTrue(gate.update("Peace", 2_000L, 1_000L))
        assertFalse(gate.update("Peace", 5_000L, 1_000L))
    }

    @Test
    fun changingOrLosingPoseResetsTheHold() {
        val gate = GestureHoldGate()
        assertFalse(gate.update("Fist", 1_000L, 1_000L))
        assertFalse(gate.update("Fist", 1_700L, 1_000L))
        assertFalse(gate.update("Point", 1_800L, 1_000L))
        assertFalse(gate.update("Fist", 1_900L, 1_000L))
        assertFalse(gate.update(null, 2_400L, 1_000L))
        assertFalse(gate.update("Fist", 2_500L, 1_000L))
        assertTrue(gate.update("Fist", 3_500L, 1_000L))
    }

    @Test
    fun backwardsClockDoesNotFireEarly() {
        val gate = GestureHoldGate()
        assertFalse(gate.update("ThumbsUp", 2_000L, 500L))
        assertFalse(gate.update("ThumbsUp", 1_000L, 500L))
        assertFalse(gate.update("ThumbsUp", 2_499L, 500L))
        assertTrue(gate.update("ThumbsUp", 2_500L, 500L))
    }
}
