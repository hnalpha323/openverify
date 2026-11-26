package dev.openverify.sdk

/**
 * Marks a public declaration whose shape may still change in a minor release, even after 1.0
 * (C207.3, review H22): today the chip-reader seam, whose fit with the iOS reader is unverified
 * for CAN access (ADR 0009). Opt in with `@OptIn(ExperimentalOpenVerifyApi::class)`.
 */
@RequiresOptIn(message = "This OpenVerify API may change before it is stable.", level = RequiresOptIn.Level.ERROR)
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY, AnnotationTarget.TYPEALIAS)
public annotation class ExperimentalOpenVerifyApi
