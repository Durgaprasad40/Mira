package expo.modules.mirafacedetector

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class MiraFaceDetectorModule : Module() {
  companion object {
    @Volatile
    private var isPluginRegistered = false
  }

  override fun definition() = ModuleDefinition {
    Name("MiraFaceDetector")

    OnCreate {
      // Register only once to prevent duplicate registration on fast refresh
      if (!isPluginRegistered) {
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("miraFaceDetector") { proxy, options ->
          MiraFaceDetectorPlugin(proxy, options)
        }
        isPluginRegistered = true
      }
    }
  }
}
