import ExpoModulesCore
import VisionCamera

public class MiraFaceDetectorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MiraFaceDetector")

    OnCreate {
      VisionCameraProxyHolder.setFrameProcessorPlugin("miraFaceDetector") { proxy, options in
        return MiraFaceDetectorPlugin(proxy: proxy, options: options)
      }
    }
  }
}
