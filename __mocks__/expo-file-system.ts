/// Test stub for the native `expo-file-system` module (mapped in via the jest
/// `moduleNameMapper`). Only the surface `tempFiles.deleteTempFile` touches is
/// stubbed: a `File` whose `delete()` is a no-op — tests never create real
/// cache files, they only need the import chain (audioRecorder → tempFiles)
/// to load without the native module.
export class File {
  constructor(public readonly uri: string) {}

  delete(): void {
    /* no-op — nothing was ever written in tests */
  }
}
