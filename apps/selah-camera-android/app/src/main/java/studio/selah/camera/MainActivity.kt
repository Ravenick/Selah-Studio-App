package studio.selah.camera

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.view.Gravity
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
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
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer

class MainActivity : ComponentActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var addressInput: EditText
    private lateinit var statusText: TextView
    private lateinit var connectButton: Button
    private lateinit var scanQrButton: Button
    private lateinit var resolutionInput: Spinner
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var uploadExecutor: ExecutorService
    private val uploadInProgress = AtomicBoolean(false)
    private val lastFrameStartedAt = AtomicLong(0L)
    private val lastQrScanAt = AtomicLong(0L)
    @Volatile
    private var cameraProvider: ProcessCameraProvider? = null
    @Volatile
    private var streamAddress: URL? = null
    @Volatile
    private var pairingToken: String? = null
    @Volatile
    private var lastStatusAt = 0L
    @Volatile
    private var scanningForPairing = false
    private val qrFound = AtomicBoolean(false)
    private val qrReader = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true,
            ),
        )
    }

    private val requestCameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted && scanningForPairing) startQrScanner()
            else if (granted) startCamera()
            else {
                scanningForPairing = false
                scanQrButton.text = "Scan QR offline"
                showStatus("Camera permission is needed to scan or send a live feed.")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()
        uploadExecutor = Executors.newSingleThreadExecutor()

        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(16, 8, 16, 10)
            setBackgroundColor(0xff070b08.toInt())
        }
        val logo = ImageView(this).apply {
            setImageResource(R.drawable.selah_emerald_logo)
            scaleType = ImageView.ScaleType.CENTER_CROP
        }
        brand.addView(logo, LinearLayout.LayoutParams(42, 42))
        val brandCopy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(11, 0, 0, 0)
            addView(TextView(this@MainActivity).apply {
                text = "SELAH CAMERA"
                textSize = 15f
                setTextColor(0xffeffaf3.toInt())
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            addView(TextView(this@MainActivity).apply {
                text = "EMERALD · LOCAL VIDEO INPUT"
                textSize = 9f
                setTextColor(0xff75cf91.toInt())
                letterSpacing = .13f
            })
        }
        brand.addView(brandCopy, LinearLayout.LayoutParams(0, -2, 1f))
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
        resolutionInput = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("720p · Smooth", "1080p · Detail"),
            )
            setSelection(getSharedPreferences("camera-settings", MODE_PRIVATE).getInt("resolution", 0).coerceIn(0, 1))
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                    getSharedPreferences("camera-settings", MODE_PRIVATE).edit().putInt("resolution", position).apply()
                    if (streamAddress != null) startCamera()
                }

                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            }
        }
        connectButton = Button(this).apply {
            text = "Connect camera"
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xff39c977.toInt())
            setTextColor(0xff031008.toInt())
            setOnClickListener { connectCamera() }
        }
        scanQrButton = Button(this).apply {
            text = "Scan QR offline"
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xff18231b.toInt())
            setTextColor(0xffc7f1d3.toInt())
            setOnClickListener { toggleQrScanner() }
        }

        val cameraOptions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(resolutionInput, LinearLayout.LayoutParams(0, -2, 1f))
            addView(scanQrButton, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = 8 })
        }

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 10, 16, 14)
            setBackgroundColor(0xff080b09.toInt())
            addView(cameraOptions, LinearLayout.LayoutParams(-1, -2))
            addView(addressInput, LinearLayout.LayoutParams(-1, -2))
            addView(connectButton, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 5 })
            addView(statusText, LinearLayout.LayoutParams(-1, 52).apply { topMargin = 3 })
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xff000000.toInt())
            addView(brand, LinearLayout.LayoutParams(-1, -2))
            previewView.setMinimumHeight(220)
            addView(previewView, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(controls, LinearLayout.LayoutParams(-1, -2))
        }
        val scrollContainer = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(0xff000000.toInt())
            addView(root)
        }
        setContentView(scrollContainer)
    }

    private fun connectCamera() {
        scanningForPairing = false
        scanQrButton.text = "Scan QR offline"
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

    private fun toggleQrScanner() {
        if (scanningForPairing) {
            scanningForPairing = false
            qrFound.set(false)
            cameraProvider?.unbindAll()
            scanQrButton.text = "Scan QR offline"
            showStatus("QR scanning stopped.")
            return
        }
        scanningForPairing = true
        qrFound.set(false)
        scanQrButton.text = "Stop scanning"
        showStatus("Point the camera at the Selah Studio Connect QR code.")
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startQrScanner()
        } else {
            requestCameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startQrScanner() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            if (!scanningForPairing) return@addListener
            try {
                val provider = providerFuture.get()
                cameraProvider = provider
                val resolution = ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            android.util.Size(640, 480),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER,
                        ),
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
                        if (!scanningForPairing || qrFound.get()) return@setAnalyzer
                        val now = System.nanoTime()
                        val previous = lastQrScanAt.getAndSet(now)
                        if (now - previous < 180_000_000L) return@setAnalyzer
                        val text = decodeQr(image) ?: return@setAnalyzer
                        if (qrFound.compareAndSet(false, true)) {
                            runOnUiThread { handleScannedAddress(text) }
                        }
                    } catch (error: Exception) {
                        showStatus("QR scan error: ${error.message ?: "unknown error"}")
                    } finally {
                        image.close()
                    }
                }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (error: Exception) {
                scanningForPairing = false
                scanQrButton.text = "Scan QR offline"
                showStatus("Could not start QR scanner: ${error.message ?: "unknown error"}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun decodeQr(image: androidx.camera.core.ImageProxy): String? {
        val plane = image.planes.firstOrNull() ?: return null
        val crop = image.cropRect
        val width = crop.width()
        val height = crop.height()
        if (width <= 0 || height <= 0) return null
        val buffer = plane.buffer
        val start = buffer.position()
        val pixels = ByteArray(width * height)
        for (row in 0 until height) {
            val sourceRow = start + (crop.top + row) * plane.rowStride + crop.left * plane.pixelStride
            for (column in 0 until width) {
                pixels[row * width + column] = buffer.get(sourceRow + column * plane.pixelStride)
            }
        }
        val source = PlanarYUVLuminanceSource(pixels, width, height, 0, 0, width, height, false)
        return try {
            qrReader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
        } catch (_: NotFoundException) {
            null
        } finally {
            qrReader.reset()
        }
    }

    private fun handleScannedAddress(value: String) {
        val address = try {
            URL(value)
        } catch (_: Exception) {
            null
        }
        if (address == null || address.protocol != "http" || address.searchParameter("token").isNullOrBlank()) {
            qrFound.set(false)
            showStatus("That QR code is not a Selah Studio Connect address.")
            return
        }
        scanningForPairing = false
        scanQrButton.text = "Scan QR offline"
        cameraProvider?.unbindAll()
        addressInput.setText(value)
        showStatus("Pairing QR scanned. Connecting to Selah Studio…")
        connectCamera()
    }

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                cameraProvider = provider
                val target = if (resolutionInput.selectedItemPosition == 1) {
                    android.util.Size(1920, 1080)
                } else {
                    android.util.Size(1280, 720)
                }
                val resolution = ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            target,
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER,
                        ),
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
                        val frame = encodeFrame(bitmap)
                        bitmap.recycle()
                        if (frame == null) {
                            uploadInProgress.set(false)
                            showStatus("The selected resolution creates frames too large for this Wi-Fi feed.")
                            return@setAnalyzer
                        }
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

    private fun encodeFrame(bitmap: Bitmap): ByteArray? {
        for (quality in intArrayOf(62, 52, 42, 32, 24)) {
            val bytes = ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
                output.toByteArray()
            }
            if (bytes.size <= 480 * 1024) return bytes
        }
        return null
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
