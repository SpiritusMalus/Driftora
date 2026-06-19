/// Test stub for `expo/virtual/env` (mapped in via jest `moduleNameMapper`).
/// babel-preset-expo rewrites literal `process.env.EXPO_PUBLIC_*` reads into an
/// import from this virtual module; the real file is untransformed ESM and
/// can't load in the node test environment. This mirrors its single export so
/// `EXPO_PUBLIC_*` reads resolve straight to `process.env` during tests.
export const env = process.env;
