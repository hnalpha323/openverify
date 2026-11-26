package dev.openverify.face

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The tests' own decoder and tensor (the SDK's are internal to it) are held to committed vectors, so a
 * device comparison through them means something: the decoder to the faces OpenCV found on the drawn
 * synthetic face (`contracts/fixtures/vision/yunet-decode.json`, as the web's decoder is), and the
 * tensor to the layout that file names.
 */
class ReferenceDecoderTest {

    private val vectors = HostFiles.drawnFace()

    @Test
    fun `the reference decoder reproduces OpenCV's faces from the committed outputs`() {
        val faces = YunetReference.decode(vectors.committedOutputs(), vectors.paddedWidth, vectors.paddedHeight, vectors.scoreThreshold, vectors.nmsThreshold)

        assertEquals(vectors.expected.size, faces.size)
        vectors.expected.forEachIndexed { index, want ->
            assertEquals(want.score, faces[index].score, 1e-3)
            for (k in 0 until 4) assertEquals(want.box[k], faces[index].box[k], 0.05)
            for (k in 0 until 10) assertEquals(want.landmarks[k], faces[index].landmarks[k], 0.05)
        }
    }

    @Test
    fun `the reference tensor is BGR planes, zero-padded right and bottom to multiples of 32`() {
        val frame = HostFiles.frame(vectors.png)
        val tensor = YunetReference.tensor(frame)

        assertEquals(listOf(vectors.width, vectors.height, vectors.paddedWidth, vectors.paddedHeight), listOf(tensor.width, tensor.height, tensor.paddedWidth, tensor.paddedHeight))
        val plane = tensor.paddedWidth * tensor.paddedHeight
        // The first pixel: B, G, R planes hold its blue, green and red.
        assertEquals((frame.rgba[2].toInt() and 0xFF).toFloat(), tensor.data[0])
        assertEquals((frame.rgba[1].toInt() and 0xFF).toFloat(), tensor.data[plane])
        assertEquals((frame.rgba[0].toInt() and 0xFF).toFloat(), tensor.data[2 * plane])
        // The padding rows below the image are zero in every plane.
        for (p in 0 until 3) for (x in 0 until tensor.paddedWidth) assertEquals(0f, tensor.data[p * plane + vectors.height * tensor.paddedWidth + x])
    }

    @Test
    fun `a frame the sensor gives turned is read upright`() {
        // A 2 x 1 frame, red then blue, to be turned 90 degrees: upright it is 1 wide and 2 high.
        val rgba = byteArrayOf(255.toByte(), 0, 0, 255.toByte(), 0, 0, 255.toByte(), 255.toByte())

        val tensor = YunetReference.tensor(ReferenceFrame(2, 1, 90, rgba))

        assertEquals(listOf(1, 2), listOf(tensor.width, tensor.height))
        val plane = tensor.paddedWidth * tensor.paddedHeight
        // Upright, the top pixel is the raw frame's first (red): R plane 255, B plane 0.
        assertEquals(255f, tensor.data[2 * plane])
        assertEquals(0f, tensor.data[0])
        assertEquals(255f, tensor.data[tensor.paddedWidth])
    }
}
