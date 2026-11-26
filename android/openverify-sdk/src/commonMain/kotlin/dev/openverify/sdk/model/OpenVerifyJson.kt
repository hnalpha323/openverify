package dev.openverify.sdk.model

import kotlinx.serialization.json.Json

/**
 * JSON settings for every OpenVerify wire model. Unknown keys are ignored, so a newer server
 * can add members without breaking SDKs already in the field, and absent nullable members
 * decode as `null`.
 */
internal val OpenVerifyJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}
