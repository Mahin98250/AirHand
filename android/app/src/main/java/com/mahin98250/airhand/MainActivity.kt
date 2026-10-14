package com.mahin98250.airhand

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
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
    private lateinit var previewView: PreviewView
    private var cameraController: LifecycleCameraController? = null
    private var handAnalyzer: HandLandmarkerAnalyzer? = null
    private var cameraPreviewActive = false
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val gestureEngine = AirHandGestureEngine()

    private val speechLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val spoken = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!spoken.isNullOrBlank()) {
            status.text = "Voice input captured: “$spoken”\nNothing is sent automatically. Review and use the text in your chosen app."
        } else {
            status.text = "Voice input cancelled or no speech recognized."
        }
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCameraPreview()
        else {
            status.text = "Camera permission denied. AirHand will not access the camera until you grant permission."
            refreshCameraButton()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderDashboard()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshCameraButton()
    }

    override fun onPause() {
        // Keep camera frames in the foreground app only; stop inference before leaving AirHand.
        stopCameraPreview(updateStatus = false)
        super.onPause()
    }

    override fun onDestroy() {
        stopCameraPreview(updateStatus = false)
        cameraExecutor.shutdownNow()
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
        status = heading("Ready. Camera and gesture detection start only after an explicit user action.", 15f)
        content.addView(status)

        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.rgb(18, 27, 46))
            contentDescription = "Front camera preview. On-device hand landmark detection activates when tracking starts."
        }
        content.addView(previewView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (260 * resources.displayMetrics.density).toInt()
        ).apply { setMargins(0, 8, 0, 8) })

        detectionStatus = heading("Hand tracking is off.", 15f)
        content.addView(detectionStatus)

        cameraButton = button("Enable camera / start hand tracking") {
            if (cameraPreviewActive) {
                stopCameraPreview(updateStatus = true)
            } else if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                startCameraPreview()
            } else {
                cameraPermission.launch(Manifest.permission.CAMERA)
            }
        }
        content.addView(cameraButton)

        content.addView(button("Enable Accessibility actions") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        content.addView(button("Allow floating overlay") {
            if (Settings.canDrawOverlays(this)) {
                status.text = "Overlay permission is already enabled. Floating cursor implementation remains pending."
            } else {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
        })
        content.addView(button("Try voice typing") {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak the text you want to enter")
            }
            try {
                speechLauncher.launch(intent)
            } catch (_: Exception) {
                status.text = "No compatible speech recognition app is available on this device."
            }
        })
        content.addView(button("Emergency stop") {
            GestureCommandRouter.stop()
            stopCameraPreview(updateStatus = false)
            status.text = "Emergency stop active. Camera inference stopped and gesture dispatch disabled."
        })

        content.addView(heading("Current milestone", 20f))
        content.addView(heading(
            "MediaPipe analyzes camera frames locally and AirHand's Kotlin gesture geometry classifies stable poses. " +
                "This stage displays detection only; it does not control other apps yet.",
            14f
        ))
        content.addView(heading(
            "Safety: AirHand does not send messages automatically. Review dictated text before using it. " +
                "Secure screens and restricted apps may block automation.",
            14f
        ))
        scroll.addView(content)
        root.addView(scroll)
        setContentView(root)
        refreshCameraButton()
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
                    if (landmarks.isNotEmpty()) {
                        GestureCommandRouter.lastDetectionAtMs = System.currentTimeMillis()
                    }
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
                        if (cameraPreviewActive && !isFinishing && !isDestroyed) {
                            detectionStatus.text = message
                        }
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
            status.text = "Live hand detection is running locally. Camera frames are not sent by AirHand."
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
}
