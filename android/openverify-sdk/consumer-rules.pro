# C215.1 (decision 41): the consumer R8 rules of :openverify-sdk. They travel in its AAR as
# proguard.txt, so a host app that minifies needs no rule of its own for the SDK.
#
# The rule set is what the minified demo shows R8 needs, and nothing else. It is held by
# android/scripts/check-consumer-rules.py, which reads R8's outputs for the demo's release build.
#
# What needs no rule here:
# - the @Serializable models: every serializer is named in code (X.serializer()), never looked up by
#   class or by name, and each wire name is a string the compiler plugin wrote; kotlinx.serialization's
#   own rules, from its artifacts, cover the rest;
# - OpenVerifyInquiryActivity: the manifest names it, and AAPT keeps what a manifest names;
# - enum values that cross the activity boundary by name (FailureReason, Appearance): R8 keeps an
#   enum constant's name();
# - zxing-cpp's JNI classes: its own rule travels in its AAR.
#
# No string boundary is left (KP10-56): FlowApiException.InvalidResponse keeps its decoding failure's
# kind as a fixed code chosen by type (decodeFailure), not the class name it once read as text, so
# kotlinx.serialization's exceptions need no -keepnames and R8 may rename them. The file therefore
# holds no rule.
