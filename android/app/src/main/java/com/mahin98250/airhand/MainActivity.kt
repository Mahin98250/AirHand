package com.mahin98250.airhand

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PointF
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var detectionStatus: TextView
    private lateinit var cameraButton: Button
    private lateinit var calibrationButton: Button
    private lateinit var systemControlButton: Button
    private lateinit var previewView: PreviewView
    private var cameraController: LifecycleCameraController? = null
    private var handAnalyzer: HandLandmarkerAnalyzer? = null
    private var cameraPreviewActive = false
    private var requestGlobalAfterPermission = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val gestureEngine = AirHandGestureEngine()
    private val cursorCalibrationLock = Any()
    @Volatile private var collectingCursorCalibration = false
    private var cursorCalibrationStartedAtMs = 0L
    private var cursorRangeCalibrator: CursorRangeCalibrator? = null

    private val speechLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val spoken = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!spoken.isNullOrBlank()) {
            status.text = "Voice input captured: “$spoken”\nReview and use the text in your chosen app. AirHand never sends it automatically."
        } else {
            status.text = "Voice input cancelled or no speech recognized."
        }
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            if (requestGlobalAfterPermission) {
                requestGlobalAfterPermission = false
                requestSystemWideControl()
            } else startCameraPreview()
        } else {
            requestGlobalAfterPermission = false
            status.text = "Camera permission denied. AirHand will not access the camera until you grant permission."
            refreshCameraButton()
        }
    }

    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status.text = if (granted) {
            "Microphone permission granted. Open the AirHand keyboard and tap Voice when a text field is focused."
        } else {
            "Microphone permission denied. Keyboard typing still works; voice typing needs this permission."
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) requestSystemWideControl()
        else status.text = "System-wide mode was not started because AirHand needs a visible Stop notification. You can grant notifications in Android Settings."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderDashboard()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) {
            refreshCameraButton()
            refreshSystemControlButton()
        }
    }

    override fun onPause() {
        // The activity preview stops here; the user-started foreground service owns its separate camera session.
        stopCameraPreview(updateStatus = false)
        super.onPause()
    }

    override fun onDestroy() {
        stopCameraPreview(updateStatus = false)
        cameraExecutor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun renderDashboard() {
        val page = Color.rgb(244, 247, 252)
        val ink = Color.rgb(25, 39, 63)
        val muted = Color.rgb(104, 119, 143)
        val blue = Color.rgb(47, 105, 237)
        val line = Color.rgb(226, 233, 243)
        val white = Color.WHITE

        fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
        fun rounded(color: Int, radius: Int, stroke: Int = Color.TRANSPARENT): android.graphics.drawable.GradientDrawable =
            android.graphics.drawable.GradientDrawable().apply {
                setColor(color)
                cornerRadius = dp(radius).toFloat()
                if (stroke != Color.TRANSPARENT) setStroke(dp(1), stroke)
            }
        fun text(value: String, size: Float, color: Int = ink, bold: Boolean = false, gravity: Int = Gravity.START) =
            TextView(this).apply {
                text = value
                textSize = size
                setTextColor(color)
                this.gravity = gravity
                if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
                setLineSpacing(dp(2).toFloat(), 1f)
            }
        fun vertical(spacing: Int = 0) = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            if (spacing > 0) showDividers = LinearLayout.SHOW_DIVIDER_NONE
        }
        fun card(): com.google.android.material.card.MaterialCardView =
            com.google.android.material.card.MaterialCardView(this).apply {
                radius = dp(22).toFloat()
                cardElevation = dp(1).toFloat()
                setCardBackgroundColor(white)
                strokeWidth = dp(1)
                setStrokeColor(line)
                useCompatPadding = false
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) }
            }
        fun sectionTitle(title: String, subtitle: String? = null): LinearLayout = vertical().apply {
            addView(text(title, 17f, ink, true))
            if (subtitle != null) {
                addView(text(subtitle, 12f, muted).apply {
                    setPadding(0, dp(3), 0, 0)
                })
            }
        }
        fun button(label: String, primary: Boolean = false, action: () -> Unit): Button =
            com.google.android.material.button.MaterialButton(this).apply {
                text = label
                isAllCaps = false
                textSize = 14f
                typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
                cornerRadius = dp(14)
                insetTop = 0
                insetBottom = 0
                minimumHeight = dp(50)
                setPadding(dp(14), dp(10), dp(14), dp(10))
                backgroundTintList = android.content.res.ColorStateList.valueOf(
                    if (primary) blue else Color.rgb(241, 245, 251)
                )
                setTextColor(if (primary) white else ink)
                strokeWidth = if (primary) 0 else dp(1)
                strokeColor = android.content.res.ColorStateList.valueOf(line)
                setOnClickListener { action() }
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply {
                    topMargin = dp(5)
                    bottomMargin = dp(5)
                }
            }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(page)
        }
        val scroll = ScrollView(this).apply {
            clipToPadding = false
            isFillViewport = true
            setPadding(0, 0, 0, dp(22))
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(10))
        }

        // Brand header
        val brandRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(2), dp(2), dp(2), dp(16))
        }
        val brandMark = TextView(this).apply {
            text = "A"
            textSize = 23f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(white)
            gravity = Gravity.CENTER
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(40, 104, 237), Color.rgb(68, 190, 255))
            ).apply { cornerRadius = dp(15).toFloat() }
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginEnd = dp(12) }
        }
        brandRow.addView(brandMark)
        brandRow.addView(vertical().apply {
            addView(text("AirHand", 21f, ink, true))
            addView(text("MOBILE CONTROLLER", 10f, muted, true).apply { letterSpacing = 0.12f })
        })
        val versionPill = TextView(this).apply {
            text = "BETA"
            textSize = 10f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(blue)
            gravity = Gravity.CENTER
            background = rounded(Color.rgb(231, 239, 255), 9)
            setPadding(dp(10), dp(7), dp(10), dp(7))
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply {
                gravity = Gravity.CENTER_VERTICAL
                marginStart = dp(8)
            }
        }
        brandRow.addView(versionPill)
        content.addView(brandRow)

        // Hero and live status
        val hero = card().apply {
            radius = dp(25).toFloat()
            strokeWidth = 0
            cardElevation = dp(3).toFloat()
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(24, 48, 103), Color.rgb(39, 95, 203), Color.rgb(45, 137, 226))
            ).apply { cornerRadius = dp(25).toFloat() }
            setCardBackgroundColor(Color.TRANSPARENT)
        }
        val heroContent = vertical().apply { setPadding(dp(20), dp(20), dp(20), dp(20)) }
        heroContent.addView(text("HANDS-FREE, AT YOUR PACE", 10f, Color.rgb(194, 219, 255), true).apply {
            letterSpacing = 0.14f
        })
        heroContent.addView(text("Your phone.\nYour gestures.", 29f, white, true).apply {
            setPadding(0, dp(8), 0, dp(7))
            setLineSpacing(0f, 0.98f)
        })
        heroContent.addView(text(
            "Move, tap and navigate with your hand. You stay in control at every step.",
            13f, Color.rgb(230, 240, 255)
        ))
        val statusPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(Color.argb(35, 255, 255, 255), 14, Color.argb(55, 255, 255, 255))
            setPadding(dp(13), dp(11), dp(13), dp(11))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(17) }
        }
        status = text(
            "Ready to begin. Camera, overlay, Accessibility and notification permissions are needed for system-wide control.",
            12f, white
        )
        statusPanel.addView(text("SESSION STATUS", 9f, Color.rgb(194, 219, 255), true))
        statusPanel.addView(status.apply { setPadding(0, dp(4), 0, 0) })
        heroContent.addView(statusPanel)
        hero.addView(heroContent)
        content.addView(hero)

        // Camera preview card
        val cameraCard = card()
        val cameraContent = vertical().apply { setPadding(dp(15), dp(15), dp(15), dp(15)) }
        cameraContent.addView(sectionTitle("Live hand tracking", "On-device detection · camera frames stay on your phone"))
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.rgb(13, 22, 42))
            contentDescription = "Front camera preview. On-device hand landmark detection activates when preview tracking starts."
        }
        cameraContent.addView(previewView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(225)
        ).apply { topMargin = dp(13); bottomMargin = dp(10) })
        detectionStatus = text("Tracking is off. Start the camera to find your hand.", 12f, muted).apply {
            background = rounded(Color.rgb(245, 248, 252), 12)
            setPadding(dp(12), dp(11), dp(12), dp(11))
        }
        cameraContent.addView(detectionStatus)
        cameraButton = button("Start hand tracking", true) {
            if (cameraPreviewActive) stopCameraPreview(updateStatus = true)
            else if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCameraPreview()
            else cameraPermission.launch(Manifest.permission.CAMERA)
        }
        cameraContent.addView(cameraButton)
        calibrationButton = button("Calibrate cursor range · 5 seconds") { beginCursorCalibration() }
        calibrationButton.isEnabled = false
        cameraContent.addView(calibrationButton)
        cameraContent.addView(text(
            "Keep one hand fully in frame. Move your index fingertip slowly across the widest comfortable range, both horizontally and vertically.",
            11f, muted
        ).apply { setPadding(dp(2), dp(5), dp(2), dp(2)) })
        cameraCard.addView(cameraContent)
        content.addView(cameraCard)

        // Primary action card
        val controlCard = card()
        val controlContent = vertical().apply { setPadding(dp(16), dp(16), dp(16), dp(16)) }
        controlContent.addView(sectionTitle("Gesture control", "Use gestures across apps where Android allows"))
        systemControlButton = button("Start system-wide control", true) { requestSystemWideControl() }
        controlContent.addView(systemControlButton)
        controlContent.addView(text(
            "A persistent notification stays available while control is active. Pause or stop at any time.",
            11f, muted
        ).apply { setPadding(dp(2), dp(5), dp(2), dp(8)) })
        controlContent.addView(text("SETUP & PERMISSIONS", 10f, muted, true).apply {
            letterSpacing = 0.1f
            setPadding(0, dp(9), 0, dp(4))
        })
        controlContent.addView(button("Enable AirHand Gesture Keyboard") {
            status.text = "Android will open Input Method Settings. Enable AirHand Gesture Keyboard there, then choose it from the keyboard picker."
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        })
        controlContent.addView(button("Choose active keyboard") {
            val manager = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            manager.showInputMethodPicker()
        })
        controlContent.addView(button("Grant microphone permission for voice typing") {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                status.text = "Microphone permission is already granted. Use the Voice key on the AirHand keyboard."
            } else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        })
        controlContent.addView(button("Enable Accessibility actions") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        controlContent.addView(button("Allow floating overlay") {
            if (Settings.canDrawOverlays(this)) status.text = "Overlay permission is already enabled."
            else startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        })
        controlContent.addView(button("Try voice recognition") {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak text for review")
            }
            try { speechLauncher.launch(intent) }
            catch (_: Exception) { status.text = "No compatible speech recognition app is available on this device." }
        })
        controlCard.addView(controlContent)
        content.addView(controlCard)

        // Gesture cheat sheet
        val gestureCard = card()
        val gestureContent = vertical().apply { setPadding(dp(16), dp(16), dp(16), dp(16)) }
        gestureContent.addView(sectionTitle("Gesture quick guide", "Learn a few simple poses to get started"))
        val gestures = listOf(
            "☝" to ("Point" to "Move cursor"),
            "🤏" to ("Pinch" to "Tap / hold"),
            "✋" to ("Open palm" to "Scroll / swipe"),
            "✌" to ("Peace sign" to "Go back"),
            "👍" to ("Thumbs-up" to "Home"),
            "✊" to ("Fist" to "Recent apps")
        )
        val gestureGrid = android.widget.GridLayout(this).apply {
            columnCount = 2
            useDefaultMargins = false
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
        }
        gestures.forEach { (emoji, info) ->
            val tile = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = rounded(Color.rgb(246, 249, 253), 14, line)
                setPadding(dp(12), dp(12), dp(10), dp(12))
                val params = android.widget.GridLayout.LayoutParams().apply {
                    width = 0
                    height = -2
                    columnSpec = android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1f)
                    setMargins(dp(3), dp(3), dp(3), dp(3))
                }
                layoutParams = params
                addView(text(emoji, 22f, blue, true))
                addView(text(info.first, 13f, ink, true).apply { setPadding(0, dp(4), 0, 0) })
                addView(text(info.second, 11f, muted))
            }
            gestureGrid.addView(tile)
        }
        gestureContent.addView(gestureGrid)
        gestureContent.addView(text(
            "A brief pinch and release taps. Hold a steady pinch for a long press. Move an open palm mostly up/down to scroll or mostly left/right to swipe. Moving while pinching cancels the tap. Navigation poses trigger once until released.",
            11f, muted
        ).apply { setPadding(dp(2), dp(10), dp(2), 0) })
        gestureCard.addView(gestureContent)
        content.addView(gestureCard)
        content.addView(button("Open complete user manual") {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://mahin98250.github.io/AirHand/android-guide.html")))
            } catch (_: Exception) {
                status.text = "Could not open the manual. Visit github.com/Mahin98250/AirHand and open android-guide.html."
            }
        })

        // Safety and emergency stop
        val safetyCard = card().apply {
            setCardBackgroundColor(Color.rgb(255, 249, 239))
            setStrokeColor(Color.rgb(248, 226, 190))
        }
        val safetyContent = vertical().apply { setPadding(dp(16), dp(15), dp(16), dp(15)) }
        safetyContent.addView(text("STAY IN CONTROL", 10f, Color.rgb(137, 89, 24), true))
        safetyContent.addView(text(
            "Review dictated text before sending. AirHand never sends messages automatically. Secure screens and some restricted apps may block gestures.",
            12f, Color.rgb(104, 78, 42)
        ).apply { setPadding(0, dp(5), 0, dp(10)) })
        safetyContent.addView(button("Emergency stop") { stopAllControl() })
        safetyCard.addView(safetyContent)
        content.addView(safetyCard)
        content.addView(text(
            "AirHand Mobile · Early access build\nCamera and system-wide controls run only after you start them.",
            10f, muted, false, Gravity.CENTER
        ).apply { setPadding(dp(10), dp(2), dp(10), dp(10)) })

        scroll.addView(content)
        root.addView(scroll)
        setContentView(root)
        refreshCameraButton()
        refreshSystemControlButton()
    }

    private fun requestSystemWideControl() {
        if (AirHandCameraService.isRunning) {
            stopAllControl()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestGlobalAfterPermission = true
            cameraPermission.launch(Manifest.permission.CAMERA)
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            status.text = "Allow AirHand to display over other apps in Android Settings, then return and tap Start again."
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return
        }
        if (AirHandAccessibilityService.instance == null) {
            status.text = "Enable AirHand Gesture Actions in Accessibility Settings, then return and tap Start again."
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Start system-wide gesture control?")
            .setMessage(
                "AirHand will keep the front camera active in a foreground service while you switch apps. " +
                    "The floating cursor follows your index fingertip. A deliberate, high-confidence pinch can tap the screen. " +
                    "A persistent notification will remain available to stop control."
            )
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Start control") { _, _ -> startSystemWideControl() }
            .show()
    }

    private fun startSystemWideControl() {
        stopCameraPreview(updateStatus = false)
        GestureCommandRouter.stop()
        GestureCommandRouter.enabled = true
        try {
            ContextCompat.startForegroundService(this, Intent(this, AirHandCameraService::class.java))
            status.text = "Starting system-wide gesture control. Check the persistent AirHand notification for running status and Stop."
            systemControlButton.text = "Stop system-wide gesture control"
            mainHandler.postDelayed({ refreshSystemControlButton() }, 1500L)
            mainHandler.postDelayed({ refreshSystemControlButton() }, 3500L)
        } catch (error: Exception) {
            GestureCommandRouter.stop()
            status.text = "Could not start system-wide mode: ${error.javaClass.simpleName}. Check camera and overlay permissions."
            refreshSystemControlButton()
        }
    }

    private fun stopAllControl() {
        GestureCommandRouter.stop()
        try { stopService(Intent(this, AirHandCameraService::class.java)) } catch (_: Exception) { }
        stopCameraPreview(updateStatus = false)
        status.text = "Emergency stop requested. Gesture actions are disabled and camera tracking is stopping."
        detectionStatus.text = "Hand tracking is off."
        refreshSystemControlButton()
    }

    private fun startCameraPreview() {
        if (isFinishing || isDestroyed || cameraPreviewActive) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            cameraPermission.launch(Manifest.permission.CAMERA)
            return
        }
        try {
            val analyzer = HandLandmarkerAnalyzer(
                context = this,
                onFrame = { landmarks, latencyMs ->
                    collectCursorCalibrationFrame(landmarks)
                    val reading = gestureEngine.update(landmarks)
                    if (landmarks.isNotEmpty()) GestureCommandRouter.lastDetectionAtMs = System.currentTimeMillis()
                    runOnUiThread {
                        if (!cameraPreviewActive || isFinishing || isDestroyed) return@runOnUiThread
                        if (landmarks.size < 21) {
                            detectionStatus.text = "No hand detected. Show one hand clearly inside the camera frame."
                        } else {
                            val stability = if (reading.stable) "stable" else "stabilizing"
                            detectionStatus.text =
                                "Hand detected • ${landmarks.size} landmarks\n" +
                                "Gesture: ${reading.gesture} ($stability; candidate: ${reading.candidate})\n" +
                                "Inference latency: ${latencyMs} ms • on-device"
                        }
                    }
                },
                onError = { message ->
                    runOnUiThread {
                        if (cameraPreviewActive && !isFinishing && !isDestroyed) detectionStatus.text = message
                    }
                }
            )
            handAnalyzer = analyzer
            val controller = LifecycleCameraController(this).apply {
                cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA
                setImageAnalysisOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                setImageAnalysisBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                setImageAnalysisAnalyzer(cameraExecutor, analyzer)
            }
            previewView.controller = controller
            controller.bindToLifecycle(this)
            cameraController = controller
            cameraPreviewActive = true
            detectionStatus.text = "Starting on-device hand model…"
            status.text = "Live hand detection is running locally. AirHand does not upload camera frames."
        } catch (error: Exception) {
            cameraPreviewActive = false
            stopCameraPreview(updateStatus = false)
            status.text = "Could not start hand tracking. Confirm the app was built with the verified model asset. (${error.javaClass.simpleName})"
            detectionStatus.text = error.message ?: "Hand tracking setup failed."
        }
        refreshCameraButton()
    }

    private fun stopCameraPreview(updateStatus: Boolean) {
        cameraPreviewActive = false
        synchronized(cursorCalibrationLock) {
            collectingCursorCalibration = false
            cursorRangeCalibrator = null
        }
        try { cameraController?.clearImageAnalysisAnalyzer() } catch (_: Exception) { }
        try { handAnalyzer?.close() } catch (_: Exception) { }
        handAnalyzer = null
        try { cameraController?.unbind() } catch (_: Exception) { }
        cameraController = null
        if (::previewView.isInitialized) previewView.controller = null
        if (::detectionStatus.isInitialized) detectionStatus.text = "Hand tracking is off."
        gestureEngine.reset()
        if (updateStatus && ::status.isInitialized) status.text = "Camera and hand tracking stopped."
        refreshCameraButton()
    }

    private fun beginCursorCalibration() {
        if (!cameraPreviewActive) {
            status.text = "Start hand tracking first, then begin cursor calibration."
            return
        }
        synchronized(cursorCalibrationLock) {
            cursorRangeCalibrator = CursorRangeCalibrator()
            cursorCalibrationStartedAtMs = SystemClock.elapsedRealtime()
            collectingCursorCalibration = true
        }
        calibrationButton.isEnabled = false
        status.text = "Calibration started. Sweep your index fingertip slowly through the widest comfortable range for five seconds."
        detectionStatus.text = "Calibrating cursor range… keep your hand visible and move horizontally and vertically."
    }

    private fun collectCursorCalibrationFrame(landmarks: List<PointF>) {
        var finished = false
        var result: CursorBounds? = null
        synchronized(cursorCalibrationLock) {
            if (!collectingCursorCalibration) return
            if (landmarks.size >= 21) {
                cursorRangeCalibrator?.add(landmarks[8].x, landmarks[8].y)
            }
            val elapsed = SystemClock.elapsedRealtime() - cursorCalibrationStartedAtMs
            if (elapsed >= CURSOR_CALIBRATION_DURATION_MS) {
                result = cursorRangeCalibrator?.finish()
                collectingCursorCalibration = false
                cursorRangeCalibrator = null
                finished = true
            }
        }
        if (!finished) return
        val calibratedBounds = result
        if (calibratedBounds != null) {
            calibratedBounds.saveTo(getSharedPreferences(CursorBounds.PREFERENCES_NAME, MODE_PRIVATE))
        }
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            calibrationButton.isEnabled = cameraPreviewActive
            if (calibratedBounds != null) {
                status.text = "Cursor range saved on this device. Stop any system-wide session and start it again to apply the new mapping."
                detectionStatus.text = "Calibration saved. Move your index finger to test the range."
            } else {
                status.text = "Calibration was not saved. Keep your hand in frame and sweep farther both horizontally and vertically, then try again."
                detectionStatus.text = "Range too small or too few valid hand samples. No settings were changed."
            }
        }
    }

    private fun refreshCameraButton() {
        if (!::cameraButton.isInitialized) return
        cameraButton.text = when {
            cameraPreviewActive -> "Stop hand tracking"
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED ->
                "Start hand tracking"
            else -> "Enable camera / start hand tracking"
        }
        if (::calibrationButton.isInitialized) {
            calibrationButton.isEnabled = cameraPreviewActive && !collectingCursorCalibration
        }
    }

    private fun refreshSystemControlButton() {
        if (!::systemControlButton.isInitialized) return
        systemControlButton.text = if (AirHandCameraService.isRunning) "Stop system-wide gesture control"
        else "Start system-wide gesture control"
    }

    companion object {
        private const val CURSOR_CALIBRATION_DURATION_MS = 5_000L
    }
}
