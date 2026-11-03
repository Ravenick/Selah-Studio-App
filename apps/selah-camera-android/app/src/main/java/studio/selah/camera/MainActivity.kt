package studio.selah.camera

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class MainActivity : ComponentActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var addressInput: EditText
    private lateinit var statusText: TextView
    private lateinit var connectButton: Button
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var uploadExecutor: ExecutorService
    private val uploadInProgress = AtomicBoolean(false)
    private val lastFrameStartedAt = AtomicLong(0L)
    private var cameraProvider: ProcessCameraProvider? = null
    private var streamAddress: URL? = null
    private var pairingToken: String? = null
    private var lastStatusAt = 0L

    private val requestCameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCamera()
            else showStatus("Camera permission is needed to send a live feed.")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()
        uploadExecutor = Executors.newSingleThreadExecutor()

        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        addressInput = EditText(this).apply {
            hint = "Paste the Selah Studio connection address"
            setSingleLine(true)
            setTextColor(0xffeffaf3.toInt())
            setHintTextColor(0xff91aa9c.toInt())
            setPadding(20, 14, 20, 14)
            setBackgroundColor(0xff102019.toInt())
        }
        statusText = TextView(this).apply {
            text = "Connect this phone and the studio computer to the same Wi-Fi."
            textSize = 14f
            setTextColor(0xffc7d9ce.toInt())
            gravity = Gravity.CENTER_VERTICAL
        }
        connectButton = Button(this).apply {
            text = "Connect camera"
            setOnClickListener { connectCamera() }
        }

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 12, 20, 20)
            setBackgroundColor(0xff07110d.toInt())
            addView(addressInput, LinearLayout.LayoutParams(-1, -2))
            addView(connectButton, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8 })
            addView(statusText, LinearLayout.LayoutParams(-1, 58).apply { topMargin = 4 })
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xff000000.toInt())
            addView(previewView, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(controls, LinearLayout.LayoutParams(-1, -2))
        }
        setContentView(root)
    }

    private fun connectCamera() {
        if (streamAddress != null) {
            cameraProvider?.unbindAll()
            streamAddress = null
            pairingToken = null
            connectButton.text = "Connect camera"
            showStatus("Camera disconnected.")
            return
        }
        val address = try {
            URL(addressInput.text.toString().trim())
        } catch (_: Exception) {
            showStatus("Paste the full local address shown in Selah Studio Connect.")
            return
        }
        val token = address.searchParameter("token")
        if (address.protocol != "http" || token.isNullOrBlank()) {
            showStatus("Use the complete http:// address and pairing token from Selah Studio.")
            return
        }
        streamAddress = URL(address.protocol, address.host, address.port, "/api/camera/frame")
        pairingToken = token
        connectButton.text = "Camera connected"
        showStatus("Connecting securely to this local Wi-Fi session…")

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            requestCameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                cameraProvider = provider
                val resolution = ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            android.util.Size(1280, 720),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER
                        )
                    )
                    .build()
                val preview = Preview.Builder()
                    .setResolutionSelector(resolution)
                    .build()
                    .also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(resolution)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(cameraExecutor) { image ->
                    try {
                        if (!uploadInProgress.compareAndSet(false, true)) return@setAnalyzer
                        val now = System.nanoTime()
                        val previous = lastFrameStartedAt.get()
                        if (now - previous < 66_000_000L || !lastFrameStartedAt.compareAndSet(previous, now)) {
                            uploadInProgress.set(false)
                            return@setAnalyzer
                        }
                        val sourceBitmap = image.toBitmap()
                        val rotation = image.imageInfo.rotationDegrees
                        val bitmap = if (rotation == 0) {
                            sourceBitmap
                        } else {
                            Bitmap.createBitmap(
                                sourceBitmap,
                                0,
                                0,
                                sourceBitmap.width,
                                sourceBitmap.height,
                                Matrix().apply { postRotate(rotation.toFloat()) },
                                true
                            ).also { sourceBitmap.recycle() }
                        }
                        val frame = ByteArrayOutputStream().use { output ->
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 62, output)
                            output.toByteArray()
                        }
                        bitmap.recycle()
                        uploadExecutor.execute { uploadFrame(frame) }
                    } catch (error: Exception) {
                        uploadInProgress.set(false)
                        showStatus("Could not encode camera frame: ${error.message ?: "unknown error"}")
                    } finally {
                        image.close()
                    }
                }
                provider.unbindAll()
                provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                )
                showStatus("Camera preview ready. Waiting for Selah Studio…")
            } catch (error: Exception) {
                showStatus("Could not start the phone camera: ${error.message ?: "unknown error"}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun uploadFrame(frame: ByteArray) {
        try {
            val address = streamAddress ?: return
            val connection = (address.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 2_000
                readTimeout = 2_000
                doOutput = true
                setFixedLengthStreamingMode(frame.size)
                setRequestProperty("Content-Type", "image/jpeg")
                setRequestProperty("X-Pairing-Token", pairingToken ?: "")
            }
            connection.outputStream.use { it.write(frame) }
            val result = connection.responseCode
            connection.disconnect()
            if (result !in 200..299) {
                showStatus("Studio rejected the camera feed (HTTP $result). Refresh the pairing address.")
            } else if (System.currentTimeMillis() - lastStatusAt > 2_000) {
                showStatus("Live camera is connected to Selah Studio over local Wi-Fi.")
            }
        } catch (error: Exception) {
            showStatus("Camera feed disconnected. Check Wi-Fi and the pairing address.")
        } finally {
            uploadInProgress.set(false)
        }
    }

    private fun URL.searchParameter(name: String): String? =
        query?.split("&")?.firstNotNullOfOrNull { part ->
            val keyValue = part.split("=", limit = 2)
            if (keyValue.firstOrNull() == name) keyValue.getOrNull(1) else null
        }

    private fun showStatus(message: String) {
        val now = System.currentTimeMillis()
        if (now - lastStatusAt < 1_000) return
        lastStatusAt = now
        runOnUiThread { statusText.text = message }
    }

    override fun onDestroy() {
        cameraProvider?.unbindAll()
        cameraExecutor.shutdown()
        uploadExecutor.shutdown()
        super.onDestroy()
    }
}
