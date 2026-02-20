package expo.modules.mirafacedetector

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class MiraFaceDetectorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MiraFaceDetector")

    OnCreate {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("miraFaceDetector") { proxy, options ->
        MiraFaceDetectorPlugin(proxy, options)
      }
    }
  }
}
