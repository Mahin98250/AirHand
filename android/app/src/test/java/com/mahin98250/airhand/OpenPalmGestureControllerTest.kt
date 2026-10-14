package com.mahin98250.airhand

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OpenPalmGestureControllerTest {
    @Test
    fun verticalMovementMapsToScrollAndIgnoresSmallTremor() {
        val controller = OpenPalmGestureController()
        assertNull(controller.update(true, 0.50f, 0.50f, 1_000L))
        assertNull(controller.update(true, 0.52f, 0.45f, 1_100L))
        assertEquals(OpenPalmAction.SCROLL_DOWN, controller.update(true, 0.52f, 0.35f, 1_200L))
    }

    @Test
    fun horizontalMovementMapsToSwipe() {
        val controller = OpenPalmGestureController()
        assertNull(controller.update(true, 0.75f, 0.50f, 1_000L))
        assertEquals(OpenPalmAction.SWIPE_LEFT, controller.update(true, 0.55f, 0.52f, 1_100L))
        assertEquals(OpenPalmAction.SWIPE_RIGHT, controller.update(true, 0.90f, 0.51f, 1_900L))
    }

    @Test
    fun dominantAxisWinsAndDiagonalDoesNotDispatchTwoActions() {
        val controller = OpenPalmGestureController()
        controller.update(true, 0.50f, 0.50f, 1_000L)
        assertEquals(OpenPalmAction.SWIPE_RIGHT, controller.update(true, 0.72f, 0.60f, 1_100L))
    }

    @Test
    fun cooldownSuppressesRepeatedActionsAndHandLossResetsBaseline() {
        val controller = OpenPalmGestureController(cooldownMs = 650L)
        controller.update(true, 0.50f, 0.50f, 1_000L)
        assertEquals(OpenPalmAction.SWIPE_RIGHT, controller.update(true, 0.70f, 0.50f, 1_100L))
        assertNull(controller.update(true, 0.95f, 0.50f, 1_300L))
        assertNull(controller.update(false, 0.95f, 0.50f, 1_400L))
        assertNull(controller.update(true, 0.20f, 0.50f, 1_500L))
    }

    @Test
    fun invalidCoordinatesNeverDispatch() {
        val controller = OpenPalmGestureController()
        controller.update(true, 0.50f, 0.50f, 1_000L)
        assertNull(controller.update(true, Float.NaN, 0.50f, 1_100L))
        assertNull(controller.update(true, 0.20f, 0.50f, 1_200L))
    }
}
