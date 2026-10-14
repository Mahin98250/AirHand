package com.mahin98250.airhand

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureCommandRouterTest {
    @After
    fun tearDown() {
        GestureCommandRouter.stop()
    }

    @Test
    fun systemActionsAreDeniedByDefault() {
        GestureCommandRouter.enabled = false
        GestureCommandRouter.lastDetectionAtMs = 990L
        assertFalse(GestureCommandRouter.mayDispatch(nowMs = 1_000L, confidence = 1.0f))
    }

    @Test
    fun clickRequiresHighConfidenceAndFreshDetection() {
        GestureCommandRouter.enabled = true
        GestureCommandRouter.lastDetectionAtMs = 950L

        assertTrue(GestureCommandRouter.mayDispatch(nowMs = 1_000L, confidence = 0.90f))
        assertFalse(GestureCommandRouter.mayDispatch(nowMs = 1_000L, confidence = 0.79f))
        assertFalse(GestureCommandRouter.mayDispatch(nowMs = 1_300L, confidence = 0.99f))
    }

    @Test
    fun nonFiniteConfidenceNeverDispatchesAnyAction() {
        GestureCommandRouter.enabled = true
        GestureCommandRouter.lastDetectionAtMs = 990L

        assertFalse(GestureCommandRouter.mayDispatch(nowMs = 1_000L, confidence = Float.NaN))
        assertFalse(GestureCommandRouter.mayDispatch(nowMs = 1_000L, confidence = Float.POSITIVE_INFINITY))
        assertFalse(GestureCommandRouter.mayDispatchNavigation(nowMs = 1_000L, confidence = Float.NaN))
        assertFalse(GestureCommandRouter.mayDispatchNavigation(nowMs = 1_000L, confidence = Float.POSITIVE_INFINITY))
    }

    @Test
    fun navigationHasASeparateConfidenceFloorButStillRequiresFreshness() {
        GestureCommandRouter.enabled = true
        GestureCommandRouter.lastDetectionAtMs = 950L

        assertTrue(GestureCommandRouter.mayDispatchNavigation(nowMs = 1_000L, confidence = 0.65f))
        assertFalse(GestureCommandRouter.mayDispatchNavigation(nowMs = 1_000L, confidence = 0.61f))
        assertFalse(GestureCommandRouter.mayDispatchNavigation(nowMs = 1_300L, confidence = 0.90f))
    }
}
