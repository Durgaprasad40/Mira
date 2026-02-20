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

    // ML Kit singleton face detector with FAST performance mode
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

        // Get media image from frame safely
        val mediaImage: Image
        try {
            mediaImage = frame.image
        } catch (e: Exception) {
            return createEmptyResult()
        }

        // Get rotation from imageProxy
        val rotationDegrees: Int
        try {
            rotationDegrees = frame.imageProxy.imageInfo.rotationDegrees
        } catch (e: Exception) {
            return createEmptyResult()
        }

        val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

        // Synchronous detection using latch with timeout
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

        // Wait up to 150ms for result (safety timeout)
        val completed = latch.await(150, TimeUnit.MILLISECONDS)

        if (!completed || error != null || detectedFaces == null) {
            return createEmptyResult()
        }

        val faces = detectedFaces!!

        // Build faces array with requested format
        val facesArray = faces.map { face ->
            val bounds = face.boundingBox
            val faceData = mutableMapOf<String, Any>(
                "bounds" to mapOf(
                    "x" to bounds.left,
                    "y" to bounds.top,
                    "width" to bounds.width(),
                    "height" to bounds.height()
                ),
                "headEulerAngleX" to face.headEulerAngleX,
                "headEulerAngleY" to face.headEulerAngleY,
                "headEulerAngleZ" to face.headEulerAngleZ
            )

            // Add tracking ID if available
            face.trackingId?.let { id ->
                faceData["trackingId"] = id
            }

            // Add classification probabilities if available
            face.smilingProbability?.let { prob ->
                faceData["smilingProbability"] = prob
            }
            face.leftEyeOpenProbability?.let { prob ->
                faceData["leftEyeOpenProbability"] = prob
            }
            face.rightEyeOpenProbability?.let { prob ->
                faceData["rightEyeOpenProbability"] = prob
            }

            faceData
        }

        return mapOf(
            "faceCount" to faces.size,
            "faces" to facesArray
        )
    }

    private fun createEmptyResult(): Map<String, Any> {
        return mapOf(
            "faceCount" to 0,
            "faces" to emptyList<Map<String, Any>>()
        )
    }
}
