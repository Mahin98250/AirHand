package com.mahin98250.airhand

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputConnection
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * User-selected Android input method. Key presses commit only into the currently focused editor.
 * AirHand's accessibility cursor can tap these visible keys after the user enables both services.
 */
class AirHandInputMethodService : InputMethodService() {
    private var inputRoot: LinearLayout? = null
    private var voiceKey: TextView? = null
    private var numberMode = false
    private var uppercase = false
    private var speechRecognizer: SpeechRecognizer? = null
    private var listening = false

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(6), dp(4), dp(6))
            setBackgroundColor(Color.rgb(12, 19, 35))
        }
        inputRoot = root
        rebuildKeyboard()
        return root
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        stopVoiceRecognition()
        super.onFinishInputView(finishingInput)
    }

    override fun onDestroy() {
        stopVoiceRecognition()
        speechRecognizer?.destroy()
        speechRecognizer = null
        inputRoot = null
        super.onDestroy()
    }

    private fun rebuildKeyboard() {
        val root = inputRoot ?: return
        root.removeAllViews()
        voiceKey = null

        val rows = if (numberMode) listOf(
            listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0"),
            listOf("@", "#", "$", "%", "&", "-", "+", "(", ")"),
            listOf("ABC", "/", ":", ";", "'", "\"", "⌫"),
        ) else listOf(
            listOf("q", "w", "e", "r", "t", "y", "u", "i", "o", "p"),
            listOf("a", "s", "d", "f", "g", "h", "j", "k", "l"),
            listOf("⇧", "z", "x", "c", "v", "b", "n", "m", "⌫"),
        )

        rows.forEach { labels ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            labels.forEach { label ->
                val displayLabel = if (uppercase && label.length == 1 && label[0].isLetter()) label.uppercase(Locale.ROOT) else label
                row.addView(makeKey(displayLabel) {
                    when (label) {
                        "⌫" -> currentInputConnection?.deleteSurroundingText(1, 0)
                        "⇧" -> { uppercase = !uppercase; rebuildKeyboard() }
                        "ABC" -> { numberMode = false; rebuildKeyboard() }
                        else -> commit(label)
                    }
                }, keyLayout(1f))
            }
            root.addView(row, LinearLayout.LayoutParams(-1, dp(48)))
        }

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        bottom.addView(makeKey(if (numberMode) "ABC" else "123") {
            numberMode = !numberMode
            rebuildKeyboard()
        }, keyLayout(1.2f))
        bottom.addView(makeKey(",") { commit(",") }, keyLayout(0.8f))
        bottom.addView(makeKey("space") { commit(" ") }, keyLayout(3.2f))
        bottom.addView(makeKey(".") { commit(".") }, keyLayout(0.8f))
        voiceKey = makeKey(if (listening) "Listening…" else "Voice") { startVoiceRecognition() }
        bottom.addView(voiceKey, keyLayout(1.45f))
        bottom.addView(makeKey("↵") { currentInputConnection?.performEditorAction(android.view.inputmethod.EditorInfo.IME_ACTION_DONE).also {
            if (it != true) commit("\n")
        } }, keyLayout(1f))
        root.addView(bottom, LinearLayout.LayoutParams(-1, dp(48)))
    }

    private fun makeKey(label: String, action: () -> Unit): TextView = TextView(this).apply {
        text = label
        textSize = if (label == "space") 12f else 16f
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        isClickable = true
        isFocusable = true
        contentDescription = when (label) {
            "⌫" -> "Delete previous character"
            "↵" -> "Enter"
            "space" -> "Space"
            "Voice", "Listening…" -> "Voice typing"
            else -> label
        }
        background = GradientDrawable().apply {
            setColor(if (label == "Voice" || label == "Listening…") Color.rgb(33, 86, 160) else Color.rgb(35, 47, 68))
            cornerRadius = dp(7).toFloat()
        }
        setOnClickListener { action() }
    }

    private fun keyLayout(weight: Float) = LinearLayout.LayoutParams(0, -1, weight).apply {
        setMargins(dp(2), dp(2), dp(2), dp(2))
    }

    private fun commit(text: String) {
        val connection: InputConnection? = currentInputConnection
        connection?.commitText(text, 1)
        if (text.isNotEmpty() && text != "\n" && text != " ") uppercase = false
    }

    private fun startVoiceRecognition() {
        if (listening) {
            stopVoiceRecognition()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Grant microphone permission in AirHand first.", Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Toast.makeText(this, "No speech-recognition provider is available.", Toast.LENGTH_LONG).show()
            return
        }
        try {
            val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
            speechRecognizer = recognizer
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { updateVoiceKey("Listening…") }
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
                override fun onError(error: Int) {
                    listening = false
                    updateVoiceKey("Voice")
                    Toast.makeText(this@AirHandInputMethodService, "Voice typing stopped. Please try again.", Toast.LENGTH_SHORT).show()
                    disposeRecognizer()
                }
                override fun onResults(results: Bundle?) {
                    val transcript = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (!transcript.isNullOrBlank()) {
                        currentInputConnection?.commitText(transcript.trim() + " ", 1)
                    }
                    listening = false
                    updateVoiceKey("Voice")
                    disposeRecognizer()
                }
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak the text to insert into the focused field")
            }
            listening = true
            updateVoiceKey("Listening…")
            recognizer.startListening(intent)
        } catch (_: Exception) {
            listening = false
            updateVoiceKey("Voice")
            Toast.makeText(this, "Could not start voice typing.", Toast.LENGTH_SHORT).show()
            disposeRecognizer()
        }
    }

    private fun stopVoiceRecognition() {
        try {
            if (listening) speechRecognizer?.cancel()
        } catch (_: Exception) { }
        listening = false
        updateVoiceKey("Voice")
        disposeRecognizer()
    }

    private fun disposeRecognizer() {
        try { speechRecognizer?.destroy() } catch (_: Exception) { }
        speechRecognizer = null
    }

    private fun updateVoiceKey(label: String) {
        voiceKey?.text = label
        voiceKey?.contentDescription = label
        voiceKey?.postInvalidate()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
