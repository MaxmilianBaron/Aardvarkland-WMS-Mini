# Android build and delivery

## Required environment

- Node.js 22+ and npm
- JDK 21 (the checked-in Gradle wrapper 8.14.3 does not run on JDK 25)
- Android SDK Platform 36, Build Tools, and platform-tools
- Android Studio is optional for CLI builds, but useful for device inspection

On Windows set the SDK path for Gradle through `android/local.properties` (it
is intentionally ignored because it is machine-specific) or `ANDROID_HOME`.
The generated project keeps `minSdkVersion = 24`, `compileSdkVersion = 36`,
and `targetSdkVersion = 36` in `android/variables.gradle`.

## Build

```powershell
# Set JAVA_HOME to your local JDK 21 installation before running Gradle.
$env:GRADLE_OPTS = '-Djavax.net.ssl.trustStoreType=Windows-ROOT'
npm run android:sync
npm run android:debug
npm run android:release:aab
```

Outputs:

- `android/app/build/outputs/apk/debug/app-debug.apk` – debug-installable APK;
- `android/app/build/outputs/bundle/release/app-release.aab` – unsigned release
  configuration artifact until a customer production keystore is supplied.

## Device install and acceptance

```powershell
adb devices
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Use `-r` to preserve existing Mini data. Verify camera permission, camera
scan, USB/Bluetooth keyboard-wedge input, JSON export/import, app relaunch,
and data persistence after an Android device restart. These are physical
acceptance checks and remain open until a real device is connected.

## Signing

Do not commit a keystore or passwords. For a Play release, configure a private
`signingConfigs.release` in the Android project or supply signing properties
through the build system, then run `bundleRelease` and verify the resulting
certificate before publication. The unsigned AAB generated here is not a
public Google Play release.
