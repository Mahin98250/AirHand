package com.mahin98250.airhand

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PinchInteractionControllerTest {
    @Test
    fun shortSteadyPinchProducesOneTapAtItsStartingPoint() {
        val controller = PinchInteractionController(longPressDelayMs = 500L, maxDriftDp = 20f)
        assertNull(controller.update(true, 100f, 200f, 0.95f, 1_000L))
        assertNull(controller.update(true, 105f, 204f, 0.92f, 1_150L))
        val action = controller.update(false, 108f, 206f, 0.4f, 1_200L)

        assertEquals(PinchActionType.TAP, action?.type)
        assertEquals(100f, action?.x ?: -1f, 0.001f)
        assertEquals(200f, action?.y ?: -1f, 0.001f)
        assertEquals(0.95f, action?.confidence ?: 0f, 0.001f)
        assertFalse(controller.isActive())
    }

    @Test
    fun longSteadyPinchProducesOneLongPressAndNeverAlsoTaps() {
        val controller = PinchInteractionController(longPressDelayMs = 500L)
        assertNull(controller.update(true, 200f, 240f, 0.93f, 1_000L))
        assertNull(controller.update(true, 204f, 242f, 0.91f, 1_300L))
        val action = controller.update(true, 202f, 241f, 0.94f, 1_500L)

        assertEquals(PinchActionType.LONG_PRESS, action?.type)
        assertNull(controller.update(true, 200f, 240f, 0.95f, 1_900L))
        assertNull(controller.update(false, 200f, 240f, 0.4f, 2_000L))
    }

    @Test
    fun cursorDriftCancelsTapAndLongPress() {
        val controller = PinchInteractionController(longPressDelayMs = 500L, maxDriftDp = 20f)
        controller.update(true, 100f, 100f, 0.95f, 1_000L)
        assertNull(controller.update(true, 130f, 100f, 0.95f, 1_100L))
        assertNull(controller.update(true, 130f, 100f, 0.95f, 1_800L))
        assertNull(controller.update(false, 130f, 100f, 0.4f, 1_900L))
    }

    @Test
    fun trackingResetCancelsPendingTap() {
        val controller = PinchInteractionController()
        controller.update(true, 300f, 400f, 0.96f, 5_000L)
        controller.reset()
        assertNull(controller.update(false, 300f, 400f, 0.3f, 5_100L))
        assertFalse(controller.isActive())
    }

    @Test
    fun weakPinchDoesNotStartAnInteraction() {
        val controller = PinchInteractionController()
        assertNull(controller.update(true, 100f, 100f, 0.80f, 1_000L))
        assertFalse(controller.isActive())
        assertNull(controller.update(false, 100f, 100f, 0.4f, 1_100L))
    }
}
