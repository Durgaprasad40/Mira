package expo.modules.mirafacedetector

import android.media.Image
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class MiraFaceDetectorPlugin(proxy: VisionCameraProxy, options: Map<String, Any>?) : FrameProcessorPlugin() {

    // Throttle: ~5 fps (200ms between detections)
    private var lastProcessedTime: Long = 0
    private val minIntervalMs: Long = 200

    // ML Kit face detector with performance options
    private val detector: FaceDetector

    init {
        val detectorOptions = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
            .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .setMinFaceSize(0.15f)
            .enableTracking()
            .build()

        detector = FaceDetection.getClient(detectorOptions)
    }

    override fun callback(frame: Frame, arguments: Map<String, Any>?): Any {
        val currentTime = System.currentTimeMillis()

        // Throttle: skip if called too soon
        if (currentTime - lastProcessedTime < minIntervalMs) {
            return createEmptyResult()
        }
        lastProcessedTime = currentTime

        // Get media image from frame
        val mediaImage: Image
        try {
            mediaImage = frame.image
        } catch (e: Exception) {
            return createEmptyResult()
        }

        // Get rotation from imageProxy
        val rotationDegrees = frame.imageProxy.imageInfo.rotationDegrees

        val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

        // Synchronous detection using latch
        val latch = CountDownLatch(1)
        var detectedFaces: List<Face>? = null
        var error: Exception? = null

        detector.process(inputImage)
            .addOnSuccessListener { faces ->
                detectedFaces = faces
                latch.countDown()
            }
            .addOnFailureListener { e ->
                error = e
                latch.countDown()
            }

        // Wait up to 100ms for result
        val completed = latch.await(100, TimeUnit.MILLISECONDS)

        if (!completed || error != null || detectedFaces == null) {
            return createEmptyResult()
        }

        val faces = detectedFaces!!
        val facesCount = faces.size

        if (facesCount == 0) {
            return mapOf(
                "hasFace" to false,
                "facesCount" to 0
            )
        }

        // Get primary face (largest or first)
        val primaryFace = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() } ?: faces[0]
        val bounds = primaryFace.boundingBox

        val primaryData = mutableMapOf<String, Any>(
            "bounds" to mapOf(
                "x" to bounds.left,
                "y" to bounds.top,
                "w" to bounds.width(),
                "h" to bounds.height()
            )
        )

        // Add angles
        primaryData["yaw"] = primaryFace.headEulerAngleY
        primaryData["pitch"] = primaryFace.headEulerAngleX
        primaryData["roll"] = primaryFace.headEulerAngleZ

        // Add classification probabilities if available
        primaryFace.leftEyeOpenProbability?.let { prob ->
            primaryData["leftEyeOpenProb"] = prob
        }
        primaryFace.rightEyeOpenProbability?.let { prob ->
            primaryData["rightEyeOpenProb"] = prob
        }
        primaryFace.smilingProbability?.let { prob ->
            primaryData["smilingProb"] = prob
        }

        return mapOf(
            "hasFace" to true,
            "facesCount" to facesCount,
            "primary" to primaryData,
            "frameWidth" to frame.imageProxy.width,
            "frameHeight" to frame.imageProxy.height
        )
    }

    private fun createEmptyResult(): Map<String, Any> {
        return mapOf(
            "hasFace" to false,
            "facesCount" to 0
        )
    }
}
