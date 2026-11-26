# C215.1 (decision 41), C209.4 (decision 30): the consumer R8 rules of openverify-nfc, published in
# its AAR and applied to a host app's minified build without the host naming them. A release check
# (android/scripts/check-consumer-rules.py) holds the AAR to this file, and the module's own
# ConsumerRulesTest holds this file to what the libraries need. No rule here names the SDK.

# The licence boundary. JMRTD, SCUBA and cert-cvc are LGPL libraries: they are kept whole and under
# their own names, so that a user can replace them with a modified version (the module's README says
# what that asks of a host app).
-keep class org.jmrtd.** { *; }
-keep class net.sf.scuba.** { *; }
-keep class org.ejbca.cvc.** { *; }

# What R8 cannot see. JMRTD asks its own Bouncy Castle provider object for algorithms by name (the
# retail MAC and triple DES of Basic Access Control, the key agreements of PACE and Chip
# Authentication, key factories), and the provider loads each algorithm's class by a name it holds as
# text. Without these two rules the minified demo held none of them: no DESede$Mappings, no MAC class.
-keep class org.bouncycastle.jcajce.provider.** { *; }
-keep class org.bouncycastle.jce.provider.** { *; }

# Bouncy Castle (MIT) is what the LGPL libraries link against: what R8 leaves of it keeps its names,
# so a replaced JMRTD still finds the classes it calls. This keeps nothing that is not used.
-keepnames class org.bouncycastle.** { *; }
