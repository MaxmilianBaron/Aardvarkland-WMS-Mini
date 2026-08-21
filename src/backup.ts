import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function downloadBackup(json: string, filename: string): Promise<'browser' | 'android'> {
  return downloadFile(new TextEncoder().encode(json), filename, 'application/json', 'Aardvarkland WMS-Mini backup');
}

export async function downloadFile(data: Uint8Array, filename: string, mimeType: string, title: string): Promise<'browser' | 'android'> {
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: filename,
      data: encodeBase64(data),
      directory: Directory.Documents,
      recursive: true,
    });
    await Share.share({ title, url: result.uri, dialogTitle: title });
    return 'android';
  }
  const blob = new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return 'browser';
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
