package dev.openverify.sdk.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.PickedPhotos
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The system photo picker: it needs no storage permission and shows only images. The picked file
 * is read and re-encoded off the main thread ([PickedPhotos]), and never stored.
 */
internal object SystemPhotoPicker : PhotoPicker {
    @Composable
    override fun rememberLauncher(onPicked: (CapturedImage?) -> Unit): () -> Unit {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val deliver by rememberUpdatedState(onPicked)
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                scope.launch {
                    val photo = withContext(Dispatchers.IO) {
                        PickedPhotos.load { context.contentResolver.openInputStream(uri) }
                    }
                    deliver(photo)
                }
            }
        }
        return {
            launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
    }
}
