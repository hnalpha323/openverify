# C215.2: R8 rules of the demo's device-test APK only (the minifiedSmoke build type minifies its tests
# too). They silence compile-time annotations that AndroidX Test and okhttp-tls name and no runtime
# needs; they keep and change nothing in the app, whose own rules are the SDK's consumer rules (C215.1).
-dontwarn com.google.errorprone.annotations.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
