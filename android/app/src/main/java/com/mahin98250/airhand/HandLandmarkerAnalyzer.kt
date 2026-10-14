package com.mahin98250.airhand

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.PointF
import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Converts CameraX RGBA frames into MediaPipe input and runs an on-device Hand Landmarker.
 * At most one frame is in flight so bitmap/image memory remains bounded on slower phones.
 */
class HandLandmarkerAnalyzer(
    context: Context,
    private val onFrame: (landmarks: List<PointF>, latencyMs: Long) -> Unit,
    private val onError: (String) -> Unit
) : ImageAnalysis.Analyzer, AutoCloseable {
    private val inFlight = AtomicBoolean(false)
    private val lock = Any()
    @Volatile private var closed = false
    private var pendingImage: MPImage? = null
    private var pendingBitmap: Bitmap? = null

    private val landmarker: HandLandmarker

    init {
        val options = HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(
                BaseOptions.builder()
                    .setModelAssetPath(MODEL_ASSET)
                    .build()
            )
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setNumHands(1)
            .setMinHandDetectionConfidence(0.55f)
            .setMinHandPresenceConfidence(0.55f)
            .setMinTrackingConfidence(0.55f)
            .setResultListener { result, input ->
                try {
                    val hand = result.landmarks().firstOrNull()
                    val points = hand?.map { PointF(it.x(), it.y()) } ?: emptyList()
                    onFrame(points, (SystemClock.uptimeMillis() - result.timestampMs()).coerceAtLeast(0L))
                } catch (error: Exception) {
                    onError("Hand-result processing failed: ${error.javaClass.simpleName}")
                } finally {
                    releasePending(input)
                }
            }
            .setErrorListener { error ->
                releasePending()
                onError(error.message ?: "MediaPipe reported a hand-tracking error.")
            }
            .build()
        landmarker = HandLandmarker.createFromOptions(context, options)
    }

    override fun analyze(imageProxy: ImageProxy) {
        if (closed || !inFlight.compareAndSet(false, true)) {
            imageProxy.close()
            return
        }

        val width = imageProxy.width
        val height = imageProxy.height
        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        val frameTime = SystemClock.uptimeMillis()
        val rawBitmap = try {
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
                val buffer = imageProxy.planes.first().buffer
                buffer.rewind()
                bitmap.copyPixelsFromBuffer(buffer)
            }
        } catch (error: Exception) {
            inFlight.set(false)
            onError("Could not prepare a camera frame: ${error.javaClass.simpleName}")
            imageProxy.close()
            return
        } finally {
            // The MediaPipe input is built from our copied bitmap, never from a live CameraX buffer.
            imageProxy.close()
        }

        var rotatedBitmap: Bitmap? = null
        var mpImage: MPImage? = null
        try {
            val transform = Matrix().apply {
                if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
                // Match the mirrored front-camera preview for cursor/landmark coordinates.
                postScale(-1f, 1f, width / 2f, height / 2f)
            }
            rotatedBitmap = Bitmap.createBitmap(rawBitmap, 0, 0, width, height, transform, true)
            if (rotatedBitmap !== rawBitmap) rawBitmap.recycle()
            mpImage = BitmapImageBuilder(rotatedBitmap).build()
            synchronized(lock) {
                if (closed) {
                    mpImage.close()
                    rotatedBitmap.recycle()
                    inFlight.set(false)
                    return
                }
                pendingImage = mpImage
                pendingBitmap = rotatedBitmap
            }
            landmarker.detectAsync(mpImage, frameTime)
        } catch (error: Exception) {
            if (rotatedBitmap == null && !rawBitmap.isRecycled) rawBitmap.recycle()
            releasePending(mpImage)
            onError("Hand tracking could not process a frame: ${error.javaClass.simpleName}")
        }
    }

    private fun releasePending(expected: MPImage? = null) {
        val resources = synchronized(lock) {
            val currentImage = pendingImage
            if (expected != null && currentImage != null && currentImage !== expected) {
                null
            } else {
                val pair = currentImage to pendingBitmap
                pendingImage = null
                pendingBitmap = null
                pair
            }
        }
        if (resources == null) {
            expected?.close()
            return
        }
        try { resources.first?.close() } catch (_: Exception) { }
        try { resources.second?.takeUnless { it.isRecycled }?.recycle() } catch (_: Exception) { }
        inFlight.set(false)
    }

    override fun close() {
        closed = true
        try { landmarker.close() } catch (_: Exception) { }
        releasePending()
    }

    companion object {
        const val MODEL_ASSET = "hand_landmarker.task"
    }
}
