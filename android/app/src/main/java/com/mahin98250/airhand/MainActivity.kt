package com.mahin98250.airhand

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
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
import android.graphics.Color
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var cameraButton: Button
    private lateinit var previewView: PreviewView
    private var cameraController: LifecycleCameraController? = null
    private var cameraPreviewActive = false

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
        // Do not keep an active camera bound while another app or system screen is in front.
        stopCameraPreview(updateStatus = false)
        super.onPause()
    }

    override fun onDestroy() {
        stopCameraPreview(updateStatus = false)
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
        status = heading("Ready. Camera and system-control features start only after an explicit user action.", 15f)
        content.addView(status)

        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.rgb(18, 27, 46))
            contentDescription = "Front camera preview. Hand tracking is not active in this milestone."
        }
        content.addView(previewView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (260 * resources.displayMetrics.density).toInt()
        ).apply { setMargins(0, 8, 0, 8) })

        cameraButton = button("Enable camera / start preview") {
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
                status.text = "Overlay permission is already enabled. Floating cursor implementation is still pending."
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
            status.text = "Emergency stop active. Camera preview stopped and gesture dispatch disabled."
        })

        content.addView(heading("Current milestone", 20f))
        content.addView(heading(
            "Native Android app and CameraX preview. The preview is not yet interpreted by a hand-landmark model. " +
                "Floating cursor, gesture keyboard, and automatic cross-app gesture dispatch remain under development.",
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
        if (isFinishing || isDestroyed) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            cameraPermission.launch(Manifest.permission.CAMERA)
            return
        }
        try {
            val controller = LifecycleCameraController(this).apply {
                cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA
            }
            previewView.controller = controller
            controller.bindToLifecycle(this)
            cameraController = controller
            cameraPreviewActive = true
            previewView.contentDescription = "Front camera preview. Hand gesture inference is not active yet."
            status.text = "Camera preview active. No frames are uploaded by this preview screen; hand inference is the next milestone."
        } catch (error: Exception) {
            stopCameraPreview(updateStatus = false)
            status.text = "Could not start front camera preview. Close other camera apps, check permission, and try again. (${error.javaClass.simpleName})"
        }
        refreshCameraButton()
    }

    private fun stopCameraPreview(updateStatus: Boolean) {
        cameraPreviewActive = false
        try {
            cameraController?.unbind()
        } catch (_: Exception) {
            // Cleanup must remain safe when camera startup only partially succeeded.
        }
        cameraController = null
        if (::previewView.isInitialized) previewView.controller = null
        if (updateStatus && ::status.isInitialized) status.text = "Camera preview stopped."
        refreshCameraButton()
    }

    private fun refreshCameraButton() {
        if (!::cameraButton.isInitialized) return
        cameraButton.text = when {
            cameraPreviewActive -> "Stop camera preview"
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED ->
                "Start camera preview"
            else -> "Enable camera / start preview"
        }
    }
}
