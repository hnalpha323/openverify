package dev.openverify.sdk

/**
 * How the SDK reaches the flow API (C191.1, C213.4; review P11): an opaque value a host makes with
 * a platform factory (on Android, `OpenVerifyAndroidTransport.okHttp(client)`) and installs through
 * [OpenVerifyComponents.transport]. A host cannot implement it. The host's interceptors then run on
 * every flow request, which carries the session token, images and chip files: install no logging
 * interceptor on a client you pass to the SDK.
 */
public abstract class FlowTransport internal constructor()
