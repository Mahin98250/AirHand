package com.mahin98250.airhand

import android.content.SharedPreferences
import kotlin.math.max
import kotlin.math.min

/**
 * Maps normalized front-camera hand landmarks to the usable screen area.
 * Bounds are learned by the user and remain local to this device.
 */
data class CursorBounds(
    val minX: Float,
    val maxX: Float,
    val minY: Float,
    val maxY: Float
) {
    init {
        require(minX.isFinite() && maxX.isFinite() && minY.isFinite() && maxY.isFinite())
        require(minX in 0f..1f && maxX in 0f..1f && minY in 0f..1f && maxY in 0f..1f)
        require(maxX > minX && maxY > minY)
    }

    fun mapX(normalizedX: Float, screenWidth: Int): Float =
        ((normalizedX - minX) / (maxX - minX)).coerceIn(0f, 1f) * screenWidth.coerceAtLeast(1)

    fun mapY(normalizedY: Float, screenHeight: Int): Float =
        ((normalizedY - minY) / (maxY - minY)).coerceIn(0f, 1f) * screenHeight.coerceAtLeast(1)

    fun saveTo(preferences: SharedPreferences) {
        preferences.edit()
            .putInt(KEY_VERSION, VERSION)
            .putFloat(KEY_MIN_X, minX)
            .putFloat(KEY_MAX_X, maxX)
            .putFloat(KEY_MIN_Y, minY)
            .putFloat(KEY_MAX_Y, maxY)
            .apply()
    }

    companion object {
        const val PREFERENCES_NAME = "airhand_preferences"
        private const val VERSION = 1
        private const val KEY_VERSION = "cursor_bounds_version"
        private const val KEY_MIN_X = "cursor_min_x"
        private const val KEY_MAX_X = "cursor_max_x"
        private const val KEY_MIN_Y = "cursor_min_y"
        private const val KEY_MAX_Y = "cursor_max_y"

        val DEFAULT = CursorBounds(0.06f, 0.94f, 0.06f, 0.94f)

        fun load(preferences: SharedPreferences): CursorBounds {
            if (preferences.getInt(KEY_VERSION, 0) != VERSION) return DEFAULT
            return try {
                CursorBounds(
                    preferences.getFloat(KEY_MIN_X, DEFAULT.minX),
                    preferences.getFloat(KEY_MAX_X, DEFAULT.maxX),
                    preferences.getFloat(KEY_MIN_Y, DEFAULT.minY),
                    preferences.getFloat(KEY_MAX_Y, DEFAULT.maxY)
                )
            } catch (_: IllegalArgumentException) {
                DEFAULT
            }
        }
    }
}

/**
 * Collects the comfortable fingertip movement range during a five-second sweep.
 * Small or incomplete movements are rejected rather than saving a cramped mapping.
 */
internal class CursorRangeCalibrator(
    private val minSamples: Int = 20,
    private val minAxisSpan: Float = 0.18f,
    private val margin: Float = 0.04f
) {
    private var samples = 0
    private var minX = 1f
    private var maxX = 0f
    private var minY = 1f
    private var maxY = 0f

    fun add(x: Float, y: Float) {
        if (!x.isFinite() || !y.isFinite() || x !in 0f..1f || y !in 0f..1f) return
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
        samples += 1
    }

    fun finish(): CursorBounds? {
        if (samples < minSamples) return null
        if (maxX - minX < minAxisSpan || maxY - minY < minAxisSpan) return null

        val safeMinX = (minX - margin).coerceIn(0f, 1f)
        val safeMaxX = (maxX + margin).coerceIn(0f, 1f)
        val safeMinY = (minY - margin).coerceIn(0f, 1f)
        val safeMaxY = (maxY + margin).coerceIn(0f, 1f)

        return try {
            CursorBounds(safeMinX, safeMaxX, safeMinY, safeMaxY)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    fun sampleCount(): Int = samples
}
