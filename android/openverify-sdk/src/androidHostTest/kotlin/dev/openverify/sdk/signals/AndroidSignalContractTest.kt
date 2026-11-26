package dev.openverify.sdk.signals

import dev.openverify.sdk.model.ContractSources
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * The SDK's copies of the flow signals contract's bounds (C94.2, C94.7) against the values the server
 * uses, read from the TypeScript sources rather than from a second copy.
 */
internal class AndroidSignalContractTest {

    @Test
    fun `the collector version is core's COLLECTOR_VERSION`() {
        val version = ContractSources.matches(CORE_SIGNAL_REGISTRY, Regex("""export const COLLECTOR_VERSION = (\d+);""")).single()

        assertEquals(version.groupValues[1].toInt(), AndroidSignalContract.COLLECTOR_VERSION)
    }

    @Test
    fun `the indicator codes are the contract's three closed lists (C210_2, Workflow 10B)`() {
        assertEquals(ContractSources.strings(CONTRACTS_FLOW_SIGNALS, "ANDROID_EMULATOR_INDICATORS"), AndroidSignalContract.EMULATOR_INDICATORS)
        assertEquals(ContractSources.strings(CONTRACTS_FLOW_SIGNALS, "ANDROID_ROOT_INDICATORS"), AndroidSignalContract.ROOT_INDICATORS)
        assertEquals(ContractSources.strings(CONTRACTS_FLOW_SIGNALS, "ANDROID_HOOKING_INDICATORS"), AndroidSignalContract.HOOKING_INDICATORS)
        assertEquals(12, AndroidSignalContract.INDICATORS_MAX)
    }

    @Test
    fun `the device classes are the contract's ANDROID_DEVICE_CLASSES`() {
        assertEquals(ContractSources.strings(CONTRACTS_FLOW_SIGNALS, "ANDROID_DEVICE_CLASSES"), AndroidSignalContract.DEVICE_CLASSES)
    }

    @Test
    fun `the ANDROID_ID pattern is the contract's`() {
        val pattern = ContractSources.matches(CONTRACTS_FLOW_SIGNALS, Regex("""'android-id': z\.string\(\)\.regex\(/\^(.+?)\$/""")).single()

        assertEquals(pattern.groupValues[1], AndroidSignalContract.ANDROID_ID.pattern)
    }

    @Test
    fun `the collector version, screen and sequence bounds are the contract's`() {
        val version = ContractSources.matches(CONTRACTS_FLOW_SIGNALS, Regex("""'collector-version': z\.int\(\)\.min\((\d+)\)\.max\(([\d_]+)\)""")).single()
        val sequence = ContractSources.matches(CONTRACTS_FLOW_SIGNALS, Regex("""sequence: z\.int\(\)\.min\((\d+)\)\.max\(([\d_]+)\)""")).single()
        val stepId = ContractSources.matches(ContractSources.FLOW_SPEC, Regex("""stepIdSchema = z\s*\.string\(\)\s*\.regex\(\s*/\^(.+?)\$/""")).single()

        assertEquals(version.bounds(), AndroidSignalContract.COLLECTOR_VERSIONS.let { it.first to it.last })
        assertEquals(sequence.bounds(), AndroidSignalContract.SEQUENCES.let { it.first to it.last })
        assertEquals(stepId.groupValues[1], AndroidSignalContract.SCREEN.pattern)
    }

    @Test
    fun `the sandbox outcomes are the contract's SANDBOX_SIGNAL_OUTCOMES`() {
        assertEquals(ContractSources.strings(CONTRACTS_FLOW_SIGNALS, "SANDBOX_SIGNAL_OUTCOMES"), AndroidSignalContract.SANDBOX_OUTCOMES)
    }

    private fun MatchResult.bounds(): Pair<Int, Int> =
        groupValues[1].replace("_", "").toInt() to groupValues[2].replace("_", "").toInt()

    private companion object {
        const val CORE_SIGNAL_REGISTRY = "packages/core/src/signal-registry.ts"
        const val CONTRACTS_FLOW_SIGNALS = "packages/contracts/src/flow-signals.ts"
    }
}
