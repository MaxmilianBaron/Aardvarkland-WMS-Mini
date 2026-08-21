import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cz.aardvarkland.wmsmini',
  appName: 'Aardvarkland WMS-Mini',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    minSdkVersion: 24,
  },
};

export default config;
