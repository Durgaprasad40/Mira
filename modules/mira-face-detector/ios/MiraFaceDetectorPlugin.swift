import VisionCamera
import MLKitFaceDetection
import MLKitVision

@objc(MiraFaceDetectorPlugin)
public class MiraFaceDetectorPlugin: FrameProcessorPlugin {

    // Throttle: ~5 fps (200ms between detections)
    private var lastProcessedTime: CFTimeInterval = 0
    private let minIntervalSec: CFTimeInterval = 0.2

    // ML Kit face detector
    private let faceDetector: FaceDetector

    public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
        // Configure face detector for fast performance
        let detectorOptions = FaceDetectorOptions()
        detectorOptions.performanceMode = .fast
        detectorOptions.landmarkMode = .none
        detectorOptions.contourMode = .none
        detectorOptions.classificationMode = .all
        detectorOptions.minFaceSize = 0.15
        detectorOptions.isTrackingEnabled = true

        faceDetector = FaceDetector.faceDetector(options: detectorOptions)

        super.init(proxy: proxy, options: options)
    }

    public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
        let currentTime = CACurrentMediaTime()

        // Throttle: skip if called too soon
        if currentTime - lastProcessedTime < minIntervalSec {
            return createEmptyResult()
        }
        lastProcessedTime = currentTime

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
            return createEmptyResult()
        }

        // Create ML Kit vision image
        let visionImage = VisionImage(buffer: frame.buffer)
        visionImage.orientation = getImageOrientation(frame: frame)

        // Synchronous detection
        var detectedFaces: [Face]?
        let semaphore = DispatchSemaphore(value: 0)

        faceDetector.process(visionImage) { faces, error in
            if error == nil {
                detectedFaces = faces
            }
            semaphore.signal()
        }

        // Wait up to 100ms
        _ = semaphore.wait(timeout: .now() + 0.1)

        guard let faces = detectedFaces else {
            return createEmptyResult()
        }

        let facesCount = faces.count

        if facesCount == 0 {
            return [
                "hasFace": false,
                "facesCount": 0
            ] as [String: Any]
        }

        // Get primary face (largest)
        let primaryFace = faces.max(by: {
            $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height
        }) ?? faces[0]

        let bounds = primaryFace.frame

        var primaryData: [String: Any] = [
            "bounds": [
                "x": bounds.origin.x,
                "y": bounds.origin.y,
                "w": bounds.width,
                "h": bounds.height
            ] as [String: Any]
        ]

        // Add angles
        primaryData["yaw"] = primaryFace.headEulerAngleY
        primaryData["pitch"] = primaryFace.headEulerAngleX
        primaryData["roll"] = primaryFace.headEulerAngleZ

        // Add classification probabilities if available
        if primaryFace.hasLeftEyeOpenProbability {
            primaryData["leftEyeOpenProb"] = primaryFace.leftEyeOpenProbability
        }
        if primaryFace.hasRightEyeOpenProbability {
            primaryData["rightEyeOpenProb"] = primaryFace.rightEyeOpenProbability
        }
        if primaryFace.hasSmilingProbability {
            primaryData["smilingProb"] = primaryFace.smilingProbability
        }

        // Get frame dimensions
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        return [
            "hasFace": true,
            "facesCount": facesCount,
            "primary": primaryData,
            "frameWidth": width,
            "frameHeight": height
        ] as [String: Any]
    }

    private func createEmptyResult() -> [String: Any] {
        return [
            "hasFace": false,
            "facesCount": 0
        ]
    }

    private func getImageOrientation(frame: Frame) -> UIImage.Orientation {
        switch frame.orientation {
        case .portrait:
            return .right
        case .portraitUpsideDown:
            return .left
        case .landscapeLeft:
            return .up
        case .landscapeRight:
            return .down
        @unknown default:
            return .up
        }
    }
}
