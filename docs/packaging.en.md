# Desktop packaging and release

AquaWisp uses Electron Builder to produce Windows and macOS desktop installers. The configuration lives in `apps/desktop/electron-builder.json`, and generated artifacts are written to the Git-ignored `release/desktop` directory.

## Local builds

Install dependencies with the Node.js and npm versions declared by the repository, then run the full verification suite:

```shell
npm ci
npm run verify
```

Build an unpacked application for the current platform:

```shell
npm run package:desktop:dir
```

Build an NSIS installer on a Windows x64 host:

```shell
npm run package:desktop:win
```

Build Intel and Apple Silicon DMGs on a macOS host:

```shell
npm run package:desktop:mac
```

A cross-platform build does not replace target-platform acceptance. Validate the Windows installer in a clean Windows 10 x64 virtual machine and validate each macOS architecture on a matching device or controlled CI runner.

## Icons and signing

The editable brand icon is `apps/desktop/build-resources/icon.svg`. Before a public release, deterministically export the platform-specific Windows `.ico` and macOS `.icns` assets from this SVG. Do not substitute emoji, font glyphs, or unlicensed bitmap artwork.

Inject signing certificates, private keys, and notarization credentials through an operating-system credential store or CI secrets. Never commit them. An artifact produced without these credentials is for internal validation only and must not be published as a release.

## Release checklist

1. Set the root and desktop package versions to the planned release version.
2. Run `npm ci`, `npm run verify`, and the target-platform packaging command.
3. Confirm that the package includes only the required `dist` JavaScript and package metadata.
4. Complete signing and notarization, then verify the resulting signatures.
5. Test installation, first launch, uninstall, data-retention behavior, and upgrades on clean systems.
6. Record artifact SHA-256 values, the build environment, commit ID, and acceptance results.
