# Aardvarkland WMS Mini

Offline warehouse app for one device. It runs as a PWA or Android app and keeps warehouse data locally.

[Live Preview](https://maxmilianbaron.github.io/Aardvarkland-WMS-Mini/) · [Android notes](ANDROID.md) · [Full WMS](https://github.com/MaxmilianBaron/Aardvarkland-WMS)

The preview stores its sample data in your browser profile.

## What it does

- products, categories, locations and minimum stock
- receiving, issuing, moving and counting
- barcodes, batches and expiry dates
- keyboard and camera scanning
- CSV/XLSX import and Excel, CSV and PDF export
- searchable, append-only movement history
- versioned JSON backup and restore
- optional local PIN lock
- Czech, English, Ukrainian, French, German and Spanish UI

## Run it

Requires Node.js 24.15+ and npm 11.12+.

```bash
git clone https://github.com/MaxmilianBaron/Aardvarkland-WMS-Mini.git
cd Aardvarkland-WMS-Mini
npm ci
npm run dev
```

Open `http://localhost:4010`.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Android

```bash
npm run android:sync
npm run android:debug
```

See [ANDROID.md](ANDROID.md) for SDK setup and release notes. Sign release builds with your own Android keystore; signing files are not included.

## Data

IndexedDB is the main store, with a localStorage fallback. There is no server account or automatic cloud synchronization. Export backups regularly and keep them outside the device.

Camera scanning, PWA installation and Android data retention should be checked on the target device.

- Security reports: [SECURITY.md](SECURITY.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[MIT](LICENSE)
