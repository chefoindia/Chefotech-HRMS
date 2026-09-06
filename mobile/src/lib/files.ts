import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import { api, tokens } from "../api/client";

/**
 * Files in and out of the app.
 *
 * Everything the API serves is private, so downloads go through the
 * authenticated proxy with the session token and are handed to the share
 * sheet from the app's own cache. Uploads come from the document picker or
 * the camera roll and are sent as multipart form data.
 */

/** Fetch a stored file by its API path and open the share sheet. */
export async function openFile(path: string, fileName: string, mimeType?: string) {
  const url = await api.fileUrl(path);
  const { access } = await tokens.get();
  const safeName = (fileName || "file").replace(/[^\w.\-]+/g, "-");
  const target = new File(Paths.cache, safeName);
  const file = await File.downloadFileAsync(url, target, {
    headers: access ? { Authorization: `Bearer ${access}` } : undefined,
    idempotent: true,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { dialogTitle: fileName, mimeType });
    return true;
  }
  return false;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
}

/** Any document or image from the phone. */
export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name || "document", mimeType: asset.mimeType || "application/octet-stream", size: asset.size };
}

/** A photo — from the camera or the library, the person chooses. */
export function pickPhoto({ allowsEditing = false, aspect }: { allowsEditing?: boolean; aspect?: [number, number] } = {}): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    Alert.alert("Add a photo", undefined, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      {
        text: "Take a photo",
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) return resolve(null);
          const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing, aspect, mediaTypes: ["images"] });
          resolve(toPicked(result));
        },
      },
      {
        text: "Choose from library",
        onPress: async () => {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) return resolve(null);
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing, aspect, mediaTypes: ["images"] });
          resolve(toPicked(result));
        },
      },
    ]);
  });
}

function toPicked(result: ImagePicker.ImagePickerResult): PickedFile | null {
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const name = asset.fileName || `photo-${Date.now()}.jpg`;
  return { uri: asset.uri, name, mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize };
}

/** Build the multipart body React Native expects for a picked file. */
export function formWithFile(file: PickedFile, fields: Record<string, string | undefined> = {}, fieldName = "file") {
  const form = new FormData();
  form.append(fieldName, { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== "") form.append(key, value);
  return form;
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
