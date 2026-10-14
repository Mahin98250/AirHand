package com.mahin98250.airhand

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * Explicitly started, visible-notification camera service for system-wide gesture mode.
 * Camera frames and landmark inference remain on-device. Stop is always available in notification.
 */
class AirHandCameraService : LifecycleService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val inferenceExecutor = Executors.newSingleThreadExecutor()
    private val gestureEngine = AirHandGestureEngine()
    private val cursorSmoother = AirHandCursorSmoother()
    private var cameraProvider: ProcessCameraProvider? = null
    private var analysisUseCase: ImageAnalysis? = null
    private var handAnalyzer: HandLandmarkerAnalyzer? = null
    private var windowManager: WindowManager? = null
    private var cursorView: CursorDotView? = null
    private var cursorParams: WindowManager.LayoutParams? = null
    private var lastStableGesture = "None"
    private var openPalmWristY: Float? = null
    private var lastScrollAtMs = 0L
    private var peaceStartedAtMs = 0L
    private var backTriggeredForPeace = false
    private var lastBackAtMs = 0L
    @Volatile private var shuttingDown = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            stopSelf()
            return START_NOT_STICKY
        }
        if (isRunning) return START_NOT_STICKY

        createNotificationChannel()
        try {
            val notification = buildNotification()
            val cameraType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            } else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, cameraType)
        } catch (error: Exception) {
            GestureCommandRouter.stop()
            stopSelf()
            return START_NOT_STICKY
        }

        if (!Settings.canDrawOverlays(this) || AirHandAccessibilityService.instance == null) {
            GestureCommandRouter.stop()
            stopSelf()
            return START_NOT_STICKY
        }

        shuttingDown = false
        isRunning = true
        try {
            installCursorOverlay()
            startCameraPipeline()
        } catch (error: Exception) {
            stopTracking()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startCameraPipeline() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            if (shuttingDown || !isRunning) return@addListener
            try {
                val provider = providerFuture.get()
                cameraProvider = provider
                val analyzer = HandLandmarkerAnalyzer(
                    context = this,
                    onFrame = { landmarks, _ ->
                        if (shuttingDown || !isRunning) return@HandLandmarkerAnalyzer
                        if (landmarks.size < 21) {
                            gestureEngine.reset()
                            cursorSmoother.reset()
                            lastStableGesture = "None"
                            resetNavigationGestureState()
                            mainHandler.post { updateCursor(0f, 0f, visible = false) }
                            return@HandLandmarkerAnalyzer
                        }

                        GestureCommandRouter.lastDetectionAtMs = System.currentTimeMillis()
                        val reading = gestureEngine.update(landmarks)
                        val tip = landmarks[8]
                        val metrics = resources.displayMetrics
                        // Map the mirrored front-camera index tip into screen coordinates.
                        val normalizedX = ((tip.x - 0.06f) / 0.88f).coerceIn(0f, 1f)
                        val normalizedY = ((tip.y - 0.06f) / 0.88f).coerceIn(0f, 1f)
                        val rawX = normalizedX * metrics.widthPixels
                        val rawY = normalizedY * metrics.heightPixels
                        val smoothed = cursorSmoother.update(rawX, rawY)
                        val screenX = smoothed.first
                        val screenY = smoothed.second
                        mainHandler.post { updateCursor(screenX, screenY, visible = true) }

                        val clickEdge = reading.stable && reading.gesture == "Pinch" &&
                            lastStableGesture != "Pinch" && reading.confidence >= CLICK_CONFIDENCE
                        if (clickEdge && GestureCommandRouter.mayDispatch(confidence = reading.confidence)) {
                            mainHandler.post {
                                AirHandAccessibilityService.instance?.performTapAt(
                                    screenX, screenY, reading.confidence
                                )
                            }
                        }

                        // Open palm is an explicit scroll mode: move the whole hand vertically.
                        // A threshold and cooldown prevent tiny tremors from repeatedly scrolling.
                        if (reading.stable && reading.gesture == "OpenPalm" &&
                            GestureCommandRouter.mayDispatchNavigation(confidence = reading.confidence)) {
                            val wristY = landmarks[0].y
                            val previousY = openPalmWristY
                            val now = System.currentTimeMillis()
                            if (previousY != null && now - lastScrollAtMs >= SCROLL_COOLDOWN_MS) {
                                val deltaY = wristY - previousY
                                if (kotlin.math.abs(deltaY) >= SCROLL_THRESHOLD) {
                                    val action = if (deltaY < 0f)
                                        AirHandAccessibilityService.NavigationAction.SCROLL_DOWN
                                    else AirHandAccessibilityService.NavigationAction.SCROLL_UP
                                    mainHandler.post {
                                        AirHandAccessibilityService.instance?.performNavigation(action, reading.confidence)
                                    }
                                    lastScrollAtMs = now
                                    openPalmWristY = wristY
                                }
                            } else if (previousY == null) {
                                openPalmWristY = wristY
                            }
                        } else {
                            openPalmWristY = null
                        }

                        // Peace sign is a deliberate long-hold Back gesture, one action per pose.
                        if (reading.stable && reading.gesture == "Peace" &&
                            GestureCommandRouter.mayDispatchNavigation(confidence = reading.confidence)) {
                            val now = System.currentTimeMillis()
                            if (peaceStartedAtMs == 0L) peaceStartedAtMs = now
                            if (!backTriggeredForPeace && now - peaceStartedAtMs >= BACK_HOLD_MS &&
                                now - lastBackAtMs >= BACK_COOLDOWN_MS) {
                                val sent = AirHandAccessibilityService.instance?.performNavigation(
                                    AirHandAccessibilityService.NavigationAction.BACK, reading.confidence
                                ) == true
                                if (sent) {
                                    backTriggeredForPeace = true
                                    lastBackAtMs = now
                                }
                            }
                        } else {
                            peaceStartedAtMs = 0L
                            backTriggeredForPeace = false
                        }

                        lastStableGesture = reading.gesture
                    },
                    onError = { message ->
                        mainHandler.post {
                            if (!shuttingDown) updateNotificationText(message)
                        }
                    }
                )
                handAnalyzer = analyzer
                val analysis = ImageAnalysis.Builder()
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(inferenceExecutor, analyzer)
                analysisUseCase = analysis
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            } catch (error: Exception) {
                mainHandler.post {
                    updateNotificationText("Camera tracking could not start. Open AirHand to retry.")
                    stopTracking()
                    stopSelf()
                }
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun resetNavigationGestureState() {
        openPalmWristY = null
        peaceStartedAtMs = 0L
        backTriggeredForPeace = false
    }

    private fun installCursorOverlay() {
        if (!Settings.canDrawOverlays(this)) throw IllegalStateException("Overlay permission is not enabled.")
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val dot = CursorDotView(this).apply { visibility = View.INVISIBLE }
        val size = (34 * resources.displayMetrics.density).toInt()
        val params = WindowManager.LayoutParams(
            size,
            size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
        }
        windowManager?.addView(dot, params)
        cursorView = dot
        cursorParams = params
    }

    private fun updateCursor(screenX: Float, screenY: Float, visible: Boolean) {
        val dot = cursorView ?: return
        val params = cursorParams ?: return
        if (!visible || shuttingDown) {
            dot.visibility = View.INVISIBLE
            return
        }
        val metrics = resources.displayMetrics
        params.x = (screenX.toInt() - params.width / 2).coerceIn(0, max(0, metrics.widthPixels - params.width))
        params.y = (screenY.toInt() - params.height / 2).coerceIn(0, max(0, metrics.heightPixels - params.height))
        dot.visibility = View.VISIBLE
        try { windowManager?.updateViewLayout(dot, params) } catch (_: Exception) { }
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_view)
        .setContentTitle("AirHand gesture control is on")
        .setContentText("Hand tracking runs on this device. Tap Stop to disable it.")
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent())
        .build()

    private fun stopPendingIntent(): PendingIntent {
        val intent = Intent(this, AirHandCameraService::class.java).apply { action = ACTION_STOP }
        return PendingIntent.getService(
            this, STOP_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "AirHand gesture control", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Visible status and stop control for AirHand's camera service." }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun updateNotificationText(message: String) {
        if (!isRunning || shuttingDown) return
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("AirHand gesture control")
            .setContentText(message.take(120))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent())
            .build()
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(NOTIFICATION_ID, notification)
        } catch (_: Exception) { }
    }

    private fun stopTracking() {
        shuttingDown = true
        isRunning = false
        GestureCommandRouter.stop()
        try { analysisUseCase?.clearAnalyzer() } catch (_: Exception) { }
        try { cameraProvider?.unbindAll() } catch (_: Exception) { }
        try { handAnalyzer?.close() } catch (_: Exception) { }
        analysisUseCase = null
        cameraProvider = null
        handAnalyzer = null
        gestureEngine.reset()
        cursorSmoother.reset()
        lastStableGesture = "None"
        resetNavigationGestureState()
        removeCursorOverlay()
        try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) } catch (_: Exception) { }
    }

    private fun removeCursorOverlay() {
        val view = cursorView
        if (view != null) {
            try { windowManager?.removeView(view) } catch (_: Exception) { }
        }
        cursorView = null
        cursorParams = null
        windowManager = null
    }

    override fun onDestroy() {
        stopTracking()
        inferenceExecutor.shutdownNow()
        super.onDestroy()
    }

    private class CursorDotView(context: android.content.Context) : View(context) {
        private val density = resources.displayMetrics.density
        private val outer = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(83, 190, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2.5f * density
        }
        private val inner = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        private val core = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(36, 117, 255)
            style = Paint.Style.FILL
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val radius = 10f * density
            canvas.drawCircle(cx, cy, radius + 2f * density, outer)
            canvas.drawCircle(cx, cy, radius, inner)
            canvas.drawCircle(cx, cy, radius - 3f * density, core)
        }
    }

    companion object {
        const val ACTION_STOP = "com.mahin98250.airhand.STOP_GESTURE_CONTROL"
        private const val CHANNEL_ID = "airhand_gesture_control"
        private const val NOTIFICATION_ID = 4107
        private const val STOP_REQUEST_CODE = 4108
        private const val CLICK_CONFIDENCE = 0.85f
        private const val SCROLL_THRESHOLD = 0.13f
        private const val SCROLL_COOLDOWN_MS = 650L
        private const val BACK_HOLD_MS = 900L
        private const val BACK_COOLDOWN_MS = 1_200L
        @Volatile var isRunning: Boolean = false
            private set
    }
}
