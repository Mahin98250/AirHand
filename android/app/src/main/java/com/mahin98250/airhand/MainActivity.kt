package com.mahin98250.airhand

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.view.Gravity
import android.graphics.Color
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var cameraButton: Button
    private val speechLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val spoken = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!spoken.isNullOrBlank()) {
            status.text = "Voice input captured: “$spoken”\nNothing is sent automatically. Review and use the text in your chosen app."
        } else {
            status.text = "Voice input cancelled or no speech recognized."
        }
    }
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status.text = if (granted) "Camera permission granted. Hand-tracking runtime is the next integration milestone." else "Camera permission denied. You can grant it later in Android Settings."
        refreshCameraButton()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderDashboard()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshStatus()
    }

    private fun renderDashboard() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 28, 28, 28)
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
            setPadding(0, 12, 0, 12)
        }
        fun button(label: String, action: () -> Unit) = Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { action() }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { setMargins(0, 8, 0, 8) }
        }

        content.addView(heading("AirHand", 34f))
        content.addView(heading("Hands-free Android controller", 18f))
        status = heading("Ready. Enable only the permissions you understand and want to use.", 15f)
        content.addView(status)

        cameraButton = button("Enable camera permission") {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                status.text = "Camera permission is granted. Live hand tracking is not yet connected in this foundation build."
            } else cameraPermission.launch(Manifest.permission.CAMERA)
        }
        content.addView(cameraButton)
        content.addView(button("Enable Accessibility actions") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        content.addView(button("Allow floating overlay") {
            if (Settings.canDrawOverlays(this)) status.text = "Overlay permission is already enabled."
            else startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        })
        content.addView(button("Try voice typing") {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak the text you want to enter")
            }
            try { speechLauncher.launch(intent) }
            catch (_: Exception) { status.text = "No compatible speech recognition app is available on this device." }
        })
        content.addView(button("Emergency stop / safety information") {
            GestureCommandRouter.enabled = false
            status.text = "Controller actions are disabled. This starter build does not run background gesture control yet."
        })
        content.addView(heading("Safety first", 20f))
        content.addView(heading("AirHand does not send messages automatically. Review dictated text before using it. Keep emergency stop easy to reach. Secure screens and restricted apps may block automation.", 14f))
        content.addView(heading("Build status: Android foundation only. Camera hand tracking, floating cursor, gesture keyboard, and cross-app gesture dispatch are not yet implemented.", 14f))
        scroll.addView(content)
        root.addView(scroll)
        setContentView(root)
    }

    private fun refreshCameraButton() {
        if (::cameraButton.isInitialized) cameraButton.text =
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                "Camera permission granted" else "Enable camera permission"
    }

    private fun refreshStatus() {
        refreshCameraButton()
        if (!GestureCommandRouter.enabled) status.text = "Safety stop is active. Re-enable control only after a deliberate user action."
    }
}
