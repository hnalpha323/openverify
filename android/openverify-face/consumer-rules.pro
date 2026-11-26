# C215.1 (decision 41): the consumer R8 rules of openverify-face, published in its AAR. A host app
# needs no rule of its own for this module.
#
# ONNX Runtime's native library (libonnxruntime4j_jni.so) finds its Java classes, their fields and
# their methods by name, and its native methods are bound by name. ONNX Runtime's own AAR (1.31.0)
# ships rules that keep only its telemetry classes, so without the rule below R8 renames or removes
# what the native code looks up, and the first inference in a minified app fails. Proven on the demo
# minified with -PopenverifyDemoArtifacts=sdk,face (docs/tdd/phase10-face-onnx.tdd.md): the mapping
# file lists these classes under their own names.
#
# No rule here names dev.openverify.sdk or this module's own classes: they are reached from code.
-keep class ai.onnxruntime.** { *; }
