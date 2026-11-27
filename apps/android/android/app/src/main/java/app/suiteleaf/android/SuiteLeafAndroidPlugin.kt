package app.suiteleaf.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.ModelPreference
import com.google.mlkit.genai.prompt.ModelReleaseStage
import com.google.mlkit.genai.prompt.generationConfig
import com.google.mlkit.genai.prompt.modelConfig
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Native Android bridge for SuiteLeaf Single-Node Mode:
 * - Google Drive OAuth (full `drive` scope via Google Identity AuthorizationClient)
 * - On-device AI via Android AICore (ML Kit GenAI Prompt API, ModelPreference.FULL)
 * - Native SAF open/export intents and Android WebView PrintManager
 */
@CapacitorPlugin(name = "SuiteLeafAndroid")
class SuiteLeafAndroidPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val activeJobs = ConcurrentHashMap<String, Job>()
    private var pendingExportBytes: ByteArray? = null
    private var pendingAuthCall: PluginCall? = null
    private lateinit var authLauncher: ActivityResultLauncher<IntentSenderRequest>
    private var generativeModel: GenerativeModel? = null

    override fun load() {
        super.load()
        authLauncher = bridge.registerForActivityResult(
            ActivityResultContracts.StartIntentSenderForResult(),
        ) { result ->
            val call = pendingAuthCall ?: return@registerForActivityResult
            pendingAuthCall = null
            handleAuthResolution(call, result)
        }
    }

    private fun getOrCreateModel(): GenerativeModel {
        generativeModel?.let { return it }
        val config = generationConfig {
            modelConfig = modelConfig {
                releaseStage = ModelReleaseStage.STABLE
                preference = ModelPreference.FULL
            }
        }
        return Generation.getClient(config).also { generativeModel = it }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        notifyListeners("appResumed", JSObject())
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        activeJobs.values.forEach { it.cancel() }
        activeJobs.clear()
        generativeModel?.close()
        generativeModel = null
        scope.cancel()
    }

    // --- Google Drive OAuth (full drive scope) ---

    @PluginMethod
    fun authorizeGoogleDrive(call: PluginCall) {
        val driveScope = call.getString("scope") ?: "https://www.googleapis.com/auth/drive"
        val authRequest = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(driveScope), Scope("email")))
            .build()

        Identity.getAuthorizationClient(activity)
            .authorize(authRequest)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    val pendingIntent = result.pendingIntent
                    if (pendingIntent == null) {
                        call.reject("Google Drive sign-in resolution is unavailable.")
                        return@addOnSuccessListener
                    }
                    val request = IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                    pendingAuthCall = call
                    authLauncher.launch(request)
                } else {
                    val token = result.accessToken
                    if (token.isNullOrEmpty()) {
                        call.reject("Google Drive did not return an access token.")
                    } else {
                        val payload = JSObject().apply {
                            put("accessToken", token)
                            result.toGoogleSignInAccount()?.email?.let { put("email", it) }
                        }
                        call.resolve(payload)
                    }
                }
            }
            .addOnFailureListener { e ->
                call.reject("Google Drive authorization failed: ${e.message}", e)
            }
    }

    private fun handleAuthResolution(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            call.reject("Google Drive sign-in was canceled.")
            return
        }
        try {
            val authResult = Identity.getAuthorizationClient(activity)
                .getAuthorizationResultFromIntent(result.data)
            val token = authResult.accessToken
            if (token.isNullOrEmpty()) {
                call.reject("Google Drive did not return an access token.")
                return
            }
            val payload = JSObject().apply {
                put("accessToken", token)
                authResult.toGoogleSignInAccount()?.email?.let { put("email", it) }
            }
            call.resolve(payload)
        } catch (e: Exception) {
            call.reject("Failed to complete Google Drive sign-in: ${e.message}", e)
        }
    }

    @PluginMethod
    fun revokeGoogleDrive(call: PluginCall) {
        call.resolve()
    }

    // --- Android AICore (ML Kit GenAI Prompt API, ModelPreference.FULL) ---

    @PluginMethod
    fun aicoreStatus(call: PluginCall) {
        scope.launch {
            try {
                val model = getOrCreateModel()
                val status = model.checkStatus()
                call.resolve(featureStatusToJs(status))
            } catch (e: Exception) {
                call.resolve(
                    JSObject().apply {
                        put("state", "error")
                        put("featureStatus", "UNAVAILABLE")
                        put("message", "Android AICore is unavailable: ${e.message}")
                    },
                )
            }
        }
    }

    @PluginMethod
    fun aicoreLoad(call: PluginCall) {
        scope.launch {
            val startedAt = System.currentTimeMillis()
            try {
                val model = getOrCreateModel()
                when (val status = model.checkStatus()) {
                    FeatureStatus.AVAILABLE -> {
                        val ready = JSObject().apply {
                            put("state", "ready")
                            put("featureStatus", "AVAILABLE")
                            put("loadMs", System.currentTimeMillis() - startedAt)
                        }
                        notifyListeners("aicoreStatus", ready)
                        call.resolve(ready)
                    }
                    FeatureStatus.DOWNLOADABLE, FeatureStatus.DOWNLOADING -> {
                        var completed = false
                        var totalBytes = 0L
                        model.download().collect { dl ->
                            when (dl) {
                                is DownloadStatus.DownloadStarted -> {
                                    totalBytes = dl.bytesToDownload
                                    notifyListeners(
                                        "aicoreStatus",
                                        JSObject().apply {
                                            put("state", "loading")
                                            put("featureStatus", "DOWNLOADING")
                                            put("progress", 0.0)
                                            put("message", "Downloading Gemini Nano via Android AICore…")
                                        },
                                    )
                                }
                                is DownloadStatus.DownloadProgress -> {
                                    val progress = if (totalBytes > 0) {
                                        (dl.totalBytesDownloaded.toDouble() / totalBytes.toDouble()).coerceIn(0.0, 1.0)
                                    } else {
                                        0.0
                                    }
                                    notifyListeners(
                                        "aicoreStatus",
                                        JSObject().apply {
                                            put("state", "loading")
                                            put("featureStatus", "DOWNLOADING")
                                            put("progress", progress)
                                            put("message", "Downloading Gemini Nano via Android AICore…")
                                        },
                                    )
                                }
                                is DownloadStatus.DownloadCompleted -> {
                                    completed = true
                                }
                                is DownloadStatus.DownloadFailed -> {
                                    throw RuntimeException("AICore model download failed: ${dl.e.message}", dl.e)
                                }
                            }
                        }
                        if (completed || model.checkStatus() == FeatureStatus.AVAILABLE) {
                            val ready = JSObject().apply {
                                put("state", "ready")
                                put("featureStatus", "AVAILABLE")
                                put("loadMs", System.currentTimeMillis() - startedAt)
                            }
                            notifyListeners("aicoreStatus", ready)
                            call.resolve(ready)
                        } else {
                            call.reject("Gemini Nano download did not complete.")
                        }
                    }
                    else -> {
                        val unavailable = featureStatusToJs(status)
                        notifyListeners("aicoreStatus", unavailable)
                        call.resolve(unavailable)
                    }
                }
            } catch (e: Exception) {
                val err = JSObject().apply {
                    put("state", "error")
                    put("featureStatus", "UNAVAILABLE")
                    put("message", e.message ?: "Could not load Gemini Nano via Android AICore.")
                }
                notifyListeners("aicoreStatus", err)
                call.resolve(err)
            }
        }
    }

    @PluginMethod
    fun aicoreGenerate(call: PluginCall) {
        val id = call.getString("id")
        val prompt = call.getString("prompt")
        if (id.isNullOrEmpty() || prompt == null) {
            call.reject("Missing generation id or prompt.")
            return
        }
        call.resolve()

        val job = scope.launch {
            val startedAt = System.currentTimeMillis()
            var firstTokenAt: Long? = null
            var outputChars = 0
            try {
                val model = getOrCreateModel()
                model.generateContentStream(prompt).collect { response ->
                    val chunk = response.candidates.firstOrNull()?.text ?: ""
                    if (chunk.isNotEmpty()) {
                        if (firstTokenAt == null) firstTokenAt = System.currentTimeMillis()
                        outputChars += chunk.length
                        notifyListeners(
                            "aicoreEvent",
                            JSObject().apply {
                                put("id", id)
                                put("type", "text")
                                put("text", chunk)
                            },
                        )
                    }
                }
                val now = System.currentTimeMillis()
                val promptMs = (firstTokenAt ?: now) - startedAt
                val generateMs = now - (firstTokenAt ?: now)
                notifyListeners(
                    "aicoreEvent",
                    JSObject().apply {
                        put("id", id)
                        put("type", "done")
                        put("reason", "stop")
                        put("promptTokens", prompt.length / 4)
                        put("cachedTokens", 0)
                        put("outputTokens", (outputChars + 3) / 4)
                        put("promptMs", promptMs)
                        put("generateMs", generateMs)
                    },
                )
            } catch (_: CancellationException) {
                notifyListeners(
                    "aicoreEvent",
                    JSObject().apply {
                        put("id", id)
                        put("type", "done")
                        put("reason", "aborted")
                        put("promptTokens", prompt.length / 4)
                        put("cachedTokens", 0)
                        put("outputTokens", (outputChars + 3) / 4)
                        put("promptMs", 0)
                        put("generateMs", 0)
                    },
                )
            } catch (e: Exception) {
                notifyListeners(
                    "aicoreEvent",
                    JSObject().apply {
                        put("id", id)
                        put("type", "error")
                        put("message", e.message ?: "AICore generation failed.")
                    },
                )
            } finally {
                activeJobs.remove(id)
            }
        }
        activeJobs[id] = job
    }

    @PluginMethod
    fun aicoreAbort(call: PluginCall) {
        val id = call.getString("id")
        if (!id.isNullOrEmpty()) {
            activeJobs.remove(id)?.cancel()
        }
        call.resolve()
    }

    private fun featureStatusToJs(status: Int): JSObject = when (status) {
        FeatureStatus.AVAILABLE -> JSObject().apply {
            put("state", "ready")
            put("featureStatus", "AVAILABLE")
        }
        FeatureStatus.DOWNLOADABLE -> JSObject().apply {
            put("state", "idle")
            put("featureStatus", "DOWNLOADABLE")
            put("message", "Gemini Nano (Full) is ready to download via Android AICore.")
        }
        FeatureStatus.DOWNLOADING -> JSObject().apply {
            put("state", "loading")
            put("featureStatus", "DOWNLOADING")
            put("message", "Downloading Gemini Nano via Android AICore…")
        }
        else -> JSObject().apply {
            put("state", "error")
            put("featureStatus", "UNAVAILABLE")
            put(
                "message",
                "Android AICore (Gemini Nano Full) is not supported on this device. Connect to a SuiteLeaf server or choose a remote endpoint.",
            )
        }
    }

    // --- Native Android SAF Open / Export & Print ---

    @PluginMethod
    fun openDocument(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(call, intent, "handleOpenDocument")
    }

    @ActivityCallback
    private fun handleOpenDocument(call: PluginCall, result: ActivityResult) {
        val uri: Uri? = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve(JSObject().apply { put("canceled", true) })
            return
        }
        scope.launch {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Could not read selected file.")
                val name = queryDisplayName(uri) ?: "document.sldoc"
                val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
                call.resolve(
                    JSObject().apply {
                        put("canceled", false)
                        put("name", name)
                        put("mimeType", mime)
                        put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    },
                )
            } catch (e: Exception) {
                call.reject("Could not open file: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun exportDocument(call: PluginCall) {
        val name = call.getString("name") ?: "export"
        val mimeType = call.getString("mimeType") ?: "application/octet-stream"
        val base64 = call.getString("base64")
        if (base64 == null) {
            call.reject("Missing export content.")
            return
        }
        pendingExportBytes = Base64.decode(base64, Base64.DEFAULT)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, name)
        }
        startActivityForResult(call, intent, "handleExportDocument")
    }

    @ActivityCallback
    private fun handleExportDocument(call: PluginCall, result: ActivityResult) {
        val uri: Uri? = result.data?.data
        val bytes = pendingExportBytes
        pendingExportBytes = null
        if (result.resultCode != Activity.RESULT_OK || uri == null || bytes == null) {
            call.resolve(JSObject().apply { put("canceled", true) })
            return
        }
        scope.launch {
            try {
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("Could not open destination for writing.")
                call.resolve(
                    JSObject().apply {
                        put("canceled", false)
                        put("path", queryDisplayName(uri) ?: uri.toString())
                    },
                )
            } catch (e: Exception) {
                call.reject("Could not export file: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun printDocument(call: PluginCall) {
        val title = call.getString("title") ?: "SuiteLeaf Document"
        activity.runOnUiThread {
            try {
                val printManager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                val adapter = bridge.webView.createPrintDocumentAdapter(title)
                printManager.print(title, adapter, PrintAttributes.Builder().build())
                call.resolve()
            } catch (e: Exception) {
                call.reject("Print failed: ${e.message}", e)
            }
        }
    }

    private fun queryDisplayName(uri: Uri): String? {
        var cursor: Cursor? = null
        return try {
            cursor = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor != null && cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) cursor.getString(idx) else null
            } else {
                null
            }
        } finally {
            cursor?.close()
        }
    }
}
