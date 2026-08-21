# Contributing

Thank you for helping improve Aardvarkland WMS Mini.

## Development setup

1. Fork and clone the repository.
2. Install Node.js 24.15+ and npm 11.12+.
3. Run `npm ci` and `npm run dev`.
4. Open `http://localhost:4010`.

Before submitting a pull request, run `npm run typecheck`, `npm test`, and `npm run build`. Add tests for storage, migration, import, backup, and inventory-rule changes. Keep the single-device and local-first boundary explicit.

Do not include real warehouse exports, signing material, generated Android output, credentials, or personal data. Use fictional sample data in tests and screenshots. Describe separately what was source-tested and what was verified in a browser or on a physical device.
