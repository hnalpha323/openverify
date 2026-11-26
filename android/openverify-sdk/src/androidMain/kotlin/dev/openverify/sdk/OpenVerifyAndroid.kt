package dev.openverify.sdk

/**
 * The process-wide registry of the optional components (C191.1, decision 6). Call [install] from
 * your `Application.onCreate`, so it holds again after process death; a second call replaces the
 * first. `:openverify-sdk` depends on no optional artifact and discovers nothing by itself.
 *
 * ```
 * class App : Application() {
 *     override fun onCreate() {
 *         super.onCreate()
 *         OpenVerifyAndroid.install(OpenVerifyComponents(eventListener = { event -> log(event) }))
 *     }
 * }
 * ```
 */
public object OpenVerifyAndroid {
    @Volatile
    private var components: OpenVerifyComponents = OpenVerifyComponents()

    /** Installs [components] for every flow this process starts from now on. */
    public fun install(components: OpenVerifyComponents) {
        this.components = components
    }

    /** What is installed; an empty [OpenVerifyComponents] until [install] is called. For tests. */
    public fun installed(): OpenVerifyComponents = components
}
