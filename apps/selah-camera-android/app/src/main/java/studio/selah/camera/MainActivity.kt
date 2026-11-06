package studio.selah.camera

import android.Manifest
import android.app.Dialog
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.view.Gravity
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
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
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
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
    private var scannerDialog: Dialog? = null
    private var scannerPreviewView: PreviewView? = null
    private var scannerStatusText: TextView? = null
    @Volatile
    private var connectionPending = false
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
                scannerDialog?.dismiss()
                if (streamAddress != null) {
                    streamAddress = null
                    pairingToken = null
                    connectButton.text = "Connect camera"
                }
                showStatus("Camera permission is needed to scan or send a live feed.", force = true)
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
            text = "Scan to connect"
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xff18231b.toInt())
            setTextColor(0xffc7f1d3.toInt())
            setOnClickListener { showQrScanner() }
        }

        val previewPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xff050705.toInt())
            addView(brand, LinearLayout.LayoutParams(-1, -2))
            addView(previewView, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        val resolutionLabel = TextView(this).apply {
            text = "CAMERA QUALITY"
            textSize = 10f
            letterSpacing = .12f
            setTextColor(0xff8ca997.toInt())
        }
        val cameraOptions = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(resolutionLabel, LinearLayout.LayoutParams(-1, -2))
            addView(resolutionInput, LinearLayout.LayoutParams(-1, 52))
        }
        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(scanQrButton, LinearLayout.LayoutParams(0, -2, 1f))
            addView(connectButton, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = 8 })
        }
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(20, 14, 20, 14)
            setBackgroundColor(0xff080b09.toInt())
            addView(TextView(this@MainActivity).apply {
                text = "CONNECT TO STUDIO"
                textSize = 12f
                letterSpacing = .12f
                setTextColor(0xff75cf91.toInt())
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }, LinearLayout.LayoutParams(-1, -2))
            addView(TextView(this@MainActivity).apply {
                text = "Scan the Studio Connect QR code or paste its full local address."
                textSize = 12f
                setTextColor(0xff9aafa2.toInt())
                setPadding(0, 5, 0, 12)
            }, LinearLayout.LayoutParams(-1, -2))
            addView(cameraOptions, LinearLayout.LayoutParams(-1, -2))
            addView(addressInput, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 10 })
            addView(actionRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 10 })
            addView(statusText, LinearLayout.LayoutParams(-1, 64).apply { topMargin = 8 })
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xff000000.toInt())
            addView(previewPanel, LinearLayout.LayoutParams(0, -1, 1.35f))
            addView(controls, LinearLayout.LayoutParams(0, -1, 1f))
        }
        setContentView(root)
    }

    private fun connectCamera() {
        if (streamAddress != null) {
            cameraProvider?.unbindAll()
            streamAddress = null
            pairingToken = null
            connectButton.text = "Connect camera"
            showStatus("Camera disconnected.", force = true)
            return
        }
        if (connectionPending) return
        val pairingAddress = parsePairingAddress(addressInput.text.toString())
        if (pairingAddress == null) {
            showStatus("Paste the complete http://…/connect?token=… address shown in Selah Studio Connect.", force = true)
            return
        }
        connectionPending = true
        connectButton.isEnabled = false
        scanQrButton.isEnabled = false
        connectButton.text = "Checking link…"
        showStatus("Checking the address and pairing token with Selah Studio…", force = true)
        uploadExecutor.execute {
            val result: Result<Int> = try {
                val connection = (pairingAddress.first.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 3_000
                    readTimeout = 3_000
                    instanceFollowRedirects = false
                }
                val response = try {
                    connection.responseCode
                } finally {
                    connection.disconnect()
                }
                Result.success(response)
            } catch (error: Exception) {
                Result.failure(error)
            }
            runOnUiThread {
                connectionPending = false
                connectButton.isEnabled = true
                scanQrButton.isEnabled = true
                result.onSuccess { response ->
                    if (response !in 200..299) {
                        connectButton.text = "Connect camera"
                        showStatus(
                            when (response) {
                                401, 403 -> "Pairing code expired or invalid. Refresh Studio Connect and scan or paste the new address."
                                404 -> "That address is not a Studio Connect session. Copy its complete connection link again."
                                else -> "Selah Studio returned HTTP $response while checking the link."
                            },
                            force = true,
                        )
                        return@onSuccess
                    }
                    streamAddress = pairingAddress.second
                    pairingToken = pairingAddress.third
                    connectButton.text = "Disconnect camera"
                    showStatus("Link verified. Starting the phone camera…", force = true)
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        startCamera()
                    } else {
                        requestCameraPermission.launch(Manifest.permission.CAMERA)
                    }
                }.onFailure { error ->
                    connectButton.text = "Connect camera"
                    showStatus(
                        "Could not reach Selah Studio: ${error.message ?: "connection timed out"}. Confirm both devices are on the same Wi-Fi and sharing is active.",
                        force = true,
                    )
                }
            }
        }
    }

    private fun parsePairingAddress(value: String): Triple<URL, URL, String>? {
        val address = try {
            URL(value.trim())
        } catch (_: Exception) {
            return null
        }
        if (!address.protocol.equals("http", ignoreCase = true) ||
            address.host.isBlank() ||
            address.path.trimEnd('/') != "/connect"
        ) return null
        val token = address.searchParameter("token")?.takeIf { it.matches(Regex("[A-Fa-f0-9]{48}")) } ?: return null
        val endpoint = try {
            URL(address.protocol, address.host, address.port, "/api/camera/frame")
        } catch (_: Exception) {
            return null
        }
        return Triple(address, endpoint, token)
    }

    private fun showQrScanner() {
        if (streamAddress != null || connectionPending) {
            showStatus("Disconnect the camera before scanning a new Studio Connect code.", force = true)
            return
        }
        if (scannerDialog?.isShowing == true) return
        scanningForPairing = true
        qrFound.set(false)
        val scannerPreview = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        scannerPreviewView = scannerPreview
        scannerStatusText = TextView(this).apply {
            text = "Point the camera at the Selah Studio Connect QR code."
            textSize = 14f
            setTextColor(0xffeffaf3.toInt())
            setPadding(16, 12, 16, 12)
        }
        val closeButton = Button(this).apply {
            text = "Cancel scan"
            setOnClickListener { scannerDialog?.dismiss() }
        }
        val scanOverlay = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(8, 4, 8, 4)
            setBackgroundColor(0xdd080b09.toInt())
            addView(scannerStatusText, LinearLayout.LayoutParams(0, -2, 1f))
            addView(closeButton, LinearLayout.LayoutParams(-2, -2))
        }
        val scannerRoot = FrameLayout(this).apply {
            setBackgroundColor(0xff000000.toInt())
            addView(scannerPreview, FrameLayout.LayoutParams(-1, -1))
            addView(
                scanOverlay,
                FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM),
            )
        }
        val dialog = Dialog(this).apply {
            setContentView(scannerRoot)
            setOnDismissListener {
                scanningForPairing = false
                qrFound.set(false)
                cameraProvider?.unbindAll()
                scannerPreviewView = null
                scannerStatusText = null
                scannerDialog = null
            }
        }
        scannerDialog = dialog
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setLayout(
                (resources.displayMetrics.widthPixels * 0.88f).toInt(),
                (resources.displayMetrics.heightPixels * 0.86f).toInt(),
            )
        }
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
                    .also { previewUseCase ->
                        val scannerPreview = scannerPreviewView ?: return@addListener
                        previewUseCase.surfaceProvider = scannerPreview.surfaceProvider
                    }
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
                scannerStatusText?.text = "Could not start scanner: ${error.message ?: "unknown error"}"
                showStatus("Could not start QR scanner: ${error.message ?: "unknown error"}", force = true)
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
        if (parsePairingAddress(value) == null) {
            qrFound.set(false)
            scannerStatusText?.text = "Not a Studio Connect QR code. Keep scanning."
            return
        }
        addressInput.setText(value.trim())
        scannerDialog?.dismiss()
        showStatus("QR scanned. Tap Connect camera to verify the link and start the feed.", force = true)
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
                val message = when (result) {
                    401, 403 -> "Studio rejected the pairing token. Refresh Studio Connect and scan or paste the new address."
                    404 -> "Studio does not recognize the camera endpoint. Update Selah Studio and reconnect."
                    else -> "Studio rejected the camera feed (HTTP $result)."
                }
                showStatus(message, force = true)
            } else if (System.currentTimeMillis() - lastStatusAt > 2_000) {
                showStatus("Live camera is connected to Selah Studio over local Wi-Fi.")
            }
        } catch (error: Exception) {
            showStatus(
                "Camera feed lost: ${error.message ?: "connection timed out"}. Check Wi-Fi, firewall permission, and that Studio Connect is still active.",
                force = true,
            )
        } finally {
            uploadInProgress.set(false)
        }
    }

    private fun URL.searchParameter(name: String): String? =
        query?.split("&")?.firstNotNullOfOrNull { part ->
            val keyValue = part.split("=", limit = 2)
            if (keyValue.firstOrNull() == name) {
                keyValue.getOrNull(1)?.let { URLDecoder.decode(it, StandardCharsets.UTF_8.name()) }
            } else {
                null
            }
        }

    private fun showStatus(message: String, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastStatusAt < 1_000) return
        lastStatusAt = now
        runOnUiThread {
            statusText.text = message
            scannerStatusText?.text = message
        }
    }

    override fun onDestroy() {
        scannerDialog?.dismiss()
        cameraProvider?.unbindAll()
        cameraExecutor.shutdown()
        uploadExecutor.shutdown()
        super.onDestroy()
    }
}
