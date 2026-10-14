package com.mahin98250.airhand

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
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
    private lateinit var systemControlButton: Button
    private lateinit var previewView: PreviewView
    private var cameraController: LifecycleCameraController? = null
    private var handAnalyzer: HandLandmarkerAnalyzer? = null
    private var cameraPreviewActive = false
    private var requestGlobalAfterPermission = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val gestureEngine = AirHandGestureEngine()

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
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 18, 28, 18)
            setBackgroundColor(Color.rgb(9, 16, 32))
        }
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        fun heading(text: String, size: Float) = TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 10, 0, 10)
        }
        fun button(label: String, action: () -> Unit) = Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { action() }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { setMargins(0, 6, 0, 6) }
        }

        content.addView(heading("AirHand", 34f))
        content.addView(heading("Hands-free Android controller", 18f))
        status = heading("Ready. System-wide mode requires camera, overlay, Accessibility and notification permissions.", 15f)
        content.addView(status)

        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.rgb(18, 27, 46))
            contentDescription = "Front camera preview. On-device hand landmark detection activates when preview tracking starts."
        }
        content.addView(previewView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (260 * resources.displayMetrics.density).toInt()
        ).apply { setMargins(0, 8, 0, 8) })

        detectionStatus = heading("Hand tracking is off.", 15f)
        content.addView(detectionStatus)

        cameraButton = button("Enable camera / start hand tracking") {
            if (cameraPreviewActive) stopCameraPreview(updateStatus = true)
            else if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCameraPreview()
            else cameraPermission.launch(Manifest.permission.CAMERA)
        }
        content.addView(cameraButton)
        systemControlButton = button("Start system-wide gesture control") { requestSystemWideControl() }
        content.addView(systemControlButton)

        content.addView(button("Enable AirHand Gesture Keyboard") {
            status.text = "Android will open Input Method Settings. Enable AirHand Gesture Keyboard there, then choose it from the keyboard picker."
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        })
        content.addView(button("Choose active keyboard") {
            val manager = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            manager.showInputMethodPicker()
        })
        content.addView(button("Grant microphone permission for voice typing") {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                status.text = "Microphone permission is already granted. Use the Voice key on the AirHand keyboard."
            } else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        })
        content.addView(button("Enable Accessibility actions") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        content.addView(button("Allow floating overlay") {
            if (Settings.canDrawOverlays(this)) status.text = "Overlay permission is already enabled."
            else startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        })
        content.addView(button("Try voice recognition here") {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak text for review")
            }
            try { speechLauncher.launch(intent) }
            catch (_: Exception) { status.text = "No compatible speech recognition app is available on this device." }
        })
        content.addView(button("Emergency stop") { stopAllControl() })

        content.addView(heading("Current milestone", 20f))
        content.addView(heading(
            "AirHand has a local hand-landmark detector, a floating cursor and a high-confidence pinch-to-tap prototype. " +
                "The AirHand keyboard supports manual key taps and opt-in voice entry. Full reliability and compatibility still require physical-device testing.",
            14f
        ))
        content.addView(heading(
            "A persistent notification provides a Stop action during system-wide mode. The controller does not send messages automatically. " +
                "Secure screens and restricted apps may block automation.",
            14f
        ))
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

    private fun refreshCameraButton() {
        if (!::cameraButton.isInitialized) return
        cameraButton.text = when {
            cameraPreviewActive -> "Stop hand tracking"
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED ->
                "Start hand tracking"
            else -> "Enable camera / start hand tracking"
        }
    }

    private fun refreshSystemControlButton() {
        if (!::systemControlButton.isInitialized) return
        systemControlButton.text = if (AirHandCameraService.isRunning) "Stop system-wide gesture control"
        else "Start system-wide gesture control"
    }
}
