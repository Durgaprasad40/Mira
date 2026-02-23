//
//  MiraFaceDetectorPluginRegister.m
//  MiraFaceDetector
//
//  Registers the Swift MiraFaceDetectorPlugin with VisionCamera
//

#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

@interface MiraFaceDetectorPlugin : FrameProcessorPlugin
@end

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(MiraFaceDetectorPlugin, miraFaceDetector)
