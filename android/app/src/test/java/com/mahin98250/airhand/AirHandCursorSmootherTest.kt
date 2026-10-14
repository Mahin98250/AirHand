package com.mahin98250.airhand

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AirHandCursorSmootherTest {
    @Test
    fun smallJitterIsSuppressed() {
        val smoother = AirHandCursorSmoother()
        val first = smoother.update(120f, 100f, 100L)
        val jitter = smoother.update(121f, 100f, 116L)

        assertEquals(120f, first.first, 0.001f)
        assertEquals(120f, jitter.first, 0.001f)
        assertEquals(100f, jitter.second, 0.001f)
    }

    @Test
    fun largeIntentionalMovementCatchesUpFasterThanBaseFilter() {
        val smoother = AirHandCursorSmoother(baseAlpha = 0.22f)
        smoother.update(100f, 100f, 100L)
        val moved = smoother.update(200f, 100f, 116L)

        assertTrue("must advance toward the target", moved.first > 120f)
        assertTrue("must not jump directly to the raw hand position", moved.first < 200f)
        assertEquals(100f, moved.second, 0.001f)
    }

    @Test
    fun resetMakesNextSampleInitializeImmediately() {
        val smoother = AirHandCursorSmoother()
        smoother.update(100f, 100f, 100L)
        smoother.update(150f, 100f, 116L)
        smoother.reset()

        val next = smoother.update(700f, 400f, 200L)
        assertEquals(700f, next.first, 0.001f)
        assertEquals(400f, next.second, 0.001f)
    }
}
