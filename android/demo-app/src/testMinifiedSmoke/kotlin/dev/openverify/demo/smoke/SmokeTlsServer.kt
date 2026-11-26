package dev.openverify.demo.smoke

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

/**
 * A TLS server on 127.0.0.1 for the smoke test's host twins, standing in for the device test's
 * `MockWebServer` with its `HeldCertificate` (neither is on the host tests' classpath). Its key and
 * certificate (subject alternative name 127.0.0.1) are made at run time by the JDK's `keytool` in a
 * temporary folder that [close] deletes; nothing is committed. Every JCA object comes from the JVM's
 * default providers, as the client's do: Robolectric installs Conscrypt first in the test JVM, and a
 * server pinned to the JDK's own TLS provider resets a Conscrypt client's handshake there.
 */
class SmokeTlsServer(private val answer: (path: String) -> Pair<Int, String>) : AutoCloseable {
    private val folder: File = Files.createTempDirectory("openverify-smoke").toFile()
    private val password = UUID.randomUUID().toString().toCharArray()
    private val store: KeyStore = newKeyStore()
    private val server: HttpsServer = HttpsServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)

    /** `METHOD path` of each request, in order, with whether it carried a bearer credential. */
    val requests: MutableList<String> = CopyOnWriteArrayList()

    /** The server's certificate, PEM-encoded: the public half only. */
    val certificatePem: String =
        "-----BEGIN CERTIFICATE-----\n" +
            Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(store.getCertificate(ALIAS).encoded) +
            "\n-----END CERTIFICATE-----\n"

    val url: String get() = "https://127.0.0.1:${server.address.port}"

    init {
        val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(store, password) }
        val context = SSLContext.getInstance("TLS").apply { init(keys.keyManagers, null, null) }
        server.httpsConfigurator = HttpsConfigurator(context)
        server.createContext("/") { exchange ->
            val bearer = exchange.requestHeaders.getFirst("Authorization")?.startsWith("Bearer ") == true
            requests += "${exchange.requestMethod} ${exchange.requestURI.path}" + if (bearer) " (bearer)" else ""
            val (status, body) = answer(exchange.requestURI.path)
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    private fun newKeyStore(): KeyStore {
        val file = File(folder, "smoke.p12")
        val keytool = File(System.getProperty("java.home"), "bin/keytool").path
        val process = ProcessBuilder(
            keytool, "-genkeypair", "-alias", ALIAS, "-keyalg", "EC", "-groupname", "secp256r1", "-sigalg", "SHA256withECDSA",
            "-dname", "CN=127.0.0.1", "-ext", "SAN=IP:127.0.0.1", "-validity", "2", "-storetype", "PKCS12",
            "-keystore", file.path, "-storepass", String(password), "-keypass", String(password),
        ).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor(60, TimeUnit.SECONDS) && process.exitValue() == 0) { "keytool failed: $output" }
        return file.inputStream().use { input -> KeyStore.getInstance("PKCS12").apply { load(input, password) } }
    }

    override fun close() {
        server.stop(0)
        folder.deleteRecursively()
    }

    private companion object {
        const val ALIAS = "smoke"
    }
}
