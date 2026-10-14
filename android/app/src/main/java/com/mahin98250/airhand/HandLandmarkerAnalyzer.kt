package com.mahin98250.airhand

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
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
 * CameraX RGBA -> upright/mirrored bitmap -> on-device MediaPipe Hand Landmarker.
 * Frame buffers are closed immediately after copying, and one inference frame is allowed in flight.
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
            .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL_ASSET).build())
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setNumHands(1)
            .setMinHandDetectionConfidence(0.55f)
            .setMinHandPresenceConfidence(0.55f)
            .setMinTrackingConfidence(0.55f)
            .setResultListener { result, input ->
                try {
                    val hand = result.landmarks().firstOrNull()
                    val points = hand?.map { PointF(it.x(), it.y()) } ?: emptyList()
                    val latency = (SystemClock.uptimeMillis() - result.timestampMs()).coerceAtLeast(0L)
                    onFrame(points, latency)
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

        val rawBitmap = try {
            copyRgbaPlane(imageProxy)
        } catch (error: Exception) {
            inFlight.set(false)
            onError("Could not prepare a camera frame: ${error.javaClass.simpleName}")
            null
        } finally {
            // Never hold CameraX's buffer while MediaPipe is running.
            imageProxy.close()
        } ?: return

        var uprightBitmap: Bitmap? = null
        var mirroredBitmap: Bitmap? = null
        var mpImage: MPImage? = null
        try {
            val rotationDegrees = imageProxy.imageInfo.rotationDegrees
            uprightBitmap = if (rotationDegrees == 0) rawBitmap else {
                val rotation = Matrix().apply { postRotate(rotationDegrees.toFloat()) }
                Bitmap.createBitmap(rawBitmap, 0, 0, rawBitmap.width, rawBitmap.height, rotation, true)
                    .also { if (it !== rawBitmap) rawBitmap.recycle() }
            }

            // Mirroring is applied after rotation so portrait and landscape cameras align consistently.
            val mirror = Matrix().apply {
                postScale(-1f, 1f, uprightBitmap.width / 2f, uprightBitmap.height / 2f)
            }
            mirroredBitmap = Bitmap.createBitmap(
                uprightBitmap, 0, 0, uprightBitmap.width, uprightBitmap.height, mirror, true
            )
            if (mirroredBitmap !== uprightBitmap) uprightBitmap.recycle()

            mpImage = BitmapImageBuilder(mirroredBitmap).build()
            synchronized(lock) {
                if (closed) {
                    mpImage.close()
                    mirroredBitmap.recycle()
                    inFlight.set(false)
                    return
                }
                pendingImage = mpImage
                pendingBitmap = mirroredBitmap
            }
            landmarker.detectAsync(mpImage, SystemClock.uptimeMillis())
        } catch (error: Exception) {
            if (mirroredBitmap == null) {
                uprightBitmap?.takeUnless { it.isRecycled }?.recycle()
                if (uprightBitmap == null) rawBitmap.takeUnless { it.isRecycled }?.recycle()
            }
            releasePending(mpImage)
            onError("Hand tracking could not process a frame: ${error.javaClass.simpleName}")
        }
    }

    private fun copyRgbaPlane(image: ImageProxy): Bitmap {
        val plane = image.planes.firstOrNull()
            ?: throw IllegalArgumentException("Camera frame has no image plane.")
        val buffer = plane.buffer.duplicate()
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        require(pixelStride >= 4 && rowStride >= image.width * pixelStride) {
            "Unexpected RGBA frame stride: row=$rowStride, pixel=$pixelStride"
        }
        val pixels = IntArray(image.width * image.height)
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        for (y in 0 until image.height) {
            val rowBase = y * rowStride
            for (x in 0 until image.width) {
                val offset = rowBase + x * pixelStride
                if (offset + 3 >= bytes.size) throw IllegalArgumentException("Camera RGBA plane is truncated.")
                val red = bytes[offset].toInt() and 0xFF
                val green = bytes[offset + 1].toInt() and 0xFF
                val blue = bytes[offset + 2].toInt() and 0xFF
                val alpha = bytes[offset + 3].toInt() and 0xFF
                pixels[y * image.width + x] = Color.argb(alpha, red, green, blue)
            }
        }
        return Bitmap.createBitmap(pixels, image.width, image.height, Bitmap.Config.ARGB_8888)
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
