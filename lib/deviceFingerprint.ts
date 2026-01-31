import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { Platform } from "react-native";

const INSTALL_ID_KEY = "mira_install_id";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateInstallId(): Promise<string> {
  let installId = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (!installId) {
    installId = generateUUID();
    await AsyncStorage.setItem(INSTALL_ID_KEY, installId);
  }
  return installId;
}

export interface DeviceFingerprintData {
  deviceId: string;
  platform: string;
  osVersion: string;
  appVersion: string;
  installId: string;
  deviceModel?: string;
}

export async function collectDeviceFingerprint(): Promise<DeviceFingerprintData> {
  const installId = await getOrCreateInstallId();

  const deviceId = Device.osBuildId || installId;

  const appVersion = "1.0.0";
  const osVersion = Device.osVersion || "unknown";
  const platform = Platform.OS;
  const deviceModel = Device.modelName || undefined;

  return {
    deviceId,
    platform,
    osVersion,
    appVersion,
    installId,
    deviceModel,
  };
}
