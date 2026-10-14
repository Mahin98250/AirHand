package com.mahin98250.airhand

import android.graphics.PointF
import kotlin.math.acos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

data class AirHandGestureReading(
    val gesture: String,
    val candidate: String,
    val confidence: Float,
    val stable: Boolean
)

/**
 * Kotlin adapter of AirHand's browser gesture geometry for MediaPipe's normalized 21-point landmarks.
 * It intentionally reports a candidate/stable gesture only; it does not execute system actions.
 */
class AirHandGestureEngine(private val holdMs: Long = 115L) {
    private var stable = "None"
    private var candidate = "None"
    private var candidateSince = 0L
    private var previousPinch = false
    private var lastConfidence = 0f

    fun reset(): AirHandGestureReading {
        stable = "None"
        candidate = "None"
        candidateSince = 0L
        previousPinch = false
        lastConfidence = 0f
        return AirHandGestureReading(stable, candidate, 0f, true)
    }

    fun update(points: List<PointF>, nowMs: Long = android.os.SystemClock.uptimeMillis()): AirHandGestureReading {
        if (points.size < 21 || points.any { !it.x.isFinite() || !it.y.isFinite() }) return reset()

        val palmScale = max(distance(points[0], points[9]), 0.0001f)
        val index = fingerExtended(points, 5, 6, 8)
        val middle = fingerExtended(points, 9, 10, 12)
        val ring = fingerExtended(points, 13, 14, 16)
        val pinky = fingerExtended(points, 17, 18, 20)
        val thumbExtended = angle(points[2], points[3], points[4]) >= 118f &&
            distance(points[4], points[5]) / palmScale >= 0.48f
        val pinchRatio = distance(points[4], points[8]) / palmScale
        val pinchThreshold = if (previousPinch) 0.43f else 0.28f
        val raw: Pair<String, Float> = if (pinchRatio < pinchThreshold) {
            val strength = ((0.43f - pinchRatio) / (0.43f - 0.18f)).coerceIn(0f, 1f)
            previousPinch = true
            "Pinch" to ((0.55f + strength * 0.45f) * 100f).toInt() / 100f
        } else {
            previousPinch = false
            val curledCount = listOf(index, middle, ring, pinky).count { it }
            val thumbRaised = points[4].y < points[3].y - 0.015f &&
                points[4].y < points[0].y - 0.025f
            when {
                thumbExtended && thumbRaised && curledCount == 0 -> "ThumbsUp" to 0.70f
                index && middle && !ring && !pinky -> "Peace" to 0.70f
                index && !middle && !ring && !pinky -> "Point" to 0.70f
                index && middle && ring && pinky && thumbExtended -> "OpenPalm" to 0.65f
                !index && !middle && !ring && !pinky && !thumbExtended -> "Fist" to 0.70f
                else -> "Unclear" to 0.40f
            }
        }

        lastConfidence = raw.second
        if (raw.first != candidate) {
            candidate = raw.first
            candidateSince = nowMs
        } else if (raw.first != stable && nowMs - candidateSince >= holdMs) {
            stable = raw.first
        }
        return AirHandGestureReading(stable, candidate, lastConfidence, stable == candidate)
    }

    private fun fingerExtended(points: List<PointF>, mcp: Int, pip: Int, tip: Int): Boolean {
        val jointAngle = angle(points[mcp], points[pip], points[tip])
        val wristToPip = distance(points[0], points[pip])
        val wristToTip = distance(points[0], points[tip])
        return jointAngle >= 145f && wristToTip >= wristToPip * 1.045f
    }

    private fun angle(a: PointF, vertex: PointF, c: PointF): Float {
        val ax = a.x - vertex.x
        val ay = a.y - vertex.y
        val cx = c.x - vertex.x
        val cy = c.y - vertex.y
        val denominator = hypot(ax, ay) * hypot(cx, cy)
        if (denominator <= 0f) return 0f
        val cosine = ((ax * cx + ay * cy) / denominator).coerceIn(-1f, 1f)
        return Math.toDegrees(acos(cosine.toDouble())).toFloat()
    }

    private fun distance(a: PointF, b: PointF): Float = hypot(a.x - b.x, a.y - b.y)
}
