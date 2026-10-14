package com.mahin98250.airhand

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CursorCalibrationTest {
    @Test
    fun calibratedRangeExpandsSlightlyAndMapsComfortableRangeToScreen() {
        val calibration = CursorRangeCalibrator(minSamples = 4, minAxisSpan = 0.1f, margin = 0.05f)
        calibration.add(0.2f, 0.25f)
        calibration.add(0.8f, 0.75f)
        calibration.add(0.25f, 0.7f)
        calibration.add(0.75f, 0.3f)

        val bounds = calibration.finish()
        assertNotNull(bounds)
        bounds!!
        assertEquals(0.15f, bounds.minX, 0.001f)
        assertEquals(0.85f, bounds.maxX, 0.001f)
        assertEquals(0.2f, bounds.minY, 0.001f)
        assertEquals(0.8f, bounds.maxY, 0.001f)
        assertEquals(0f, bounds.mapX(-1f, 1000), 0.001f)
        assertEquals(1000f, bounds.mapX(2f, 1000), 0.001f)
        assertEquals(0f, bounds.mapY(-1f, 800), 0.001f)
        assertEquals(800f, bounds.mapY(2f, 800), 0.001f)
    }

    @Test
    fun rejectsTooFewSamplesOrAStationaryAxis() {
        val tooFew = CursorRangeCalibrator(minSamples = 3)
        tooFew.add(0.1f, 0.1f)
        tooFew.add(0.9f, 0.9f)
        assertNull(tooFew.finish())

        val stationary = CursorRangeCalibrator(minSamples = 3, minAxisSpan = 0.18f)
        stationary.add(0.1f, 0.2f)
        stationary.add(0.9f, 0.21f)
        stationary.add(0.5f, 0.22f)
        assertNull(stationary.finish())
    }

    @Test
    fun ignoresInvalidCoordinatesAndFailsWhenNotEnoughValidSamplesRemain() {
        val calibration = CursorRangeCalibrator(minSamples = 2)
        calibration.add(Float.NaN, 0.4f)
        calibration.add(0.3f, Float.POSITIVE_INFINITY)
        calibration.add(1.5f, 0.5f)
        calibration.add(0.3f, 0.3f)
        assertEquals(1, calibration.sampleCount())
        assertFalse(calibration.finish() != null)
    }

    @Test
    fun defaultBoundsRemainUsableAndStayInsideNormalizedRange() {
        assertTrue(CursorBounds.DEFAULT.minX >= 0f)
        assertTrue(CursorBounds.DEFAULT.maxX <= 1f)
        assertTrue(CursorBounds.DEFAULT.minY >= 0f)
        assertTrue(CursorBounds.DEFAULT.maxY <= 1f)
        assertEquals(0.06f, CursorBounds.DEFAULT.minX, 0.001f)
    }
}
