import { describe, expect, it } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { injectSigningConfig } = require('../plugins/withReleaseSigning');

/**
 * The plugin edits generated Gradle by string surgery, which is fine right up
 * until the Expo template moves a line — and then the failure is the worst kind
 * available: a build that succeeds and ships signed with the WORLD-KNOWN debug
 * key. Every assertion here exists to make that failure loud instead.
 */

// Shape of the Expo SDK 54 android/app/build.gradle, trimmed to what we touch.
const TEMPLATE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

const ENV = {
  storeFile: '/tmp/driftora-release.p12',
  storePassword: 'p@ss',
  keyAlias: 'driftora',
  keyPassword: 'p@ss',
};

describe('release signing plugin', () => {
  it('points the release build at our key and leaves debug alone', () => {
    const out = injectSigningConfig(TEMPLATE, ENV);

    // The release buildType must no longer reference the debug config…
    const release = out.slice(out.indexOf('release {', out.indexOf('buildTypes {')));
    expect(release).toContain('signingConfig signingConfigs.driftoraRelease');
    expect(release).not.toContain('signingConfig signingConfigs.debug');

    // …while the debug buildType still does: local `assembleDebug` must keep
    // working for anyone without the key.
    const buildTypes = out.slice(out.indexOf('buildTypes {'));
    const debugBlock = buildTypes.slice(buildTypes.indexOf('debug {'), buildTypes.indexOf('release {'));
    expect(debugBlock).toContain('signingConfig signingConfigs.debug');
  });

  it('declares the key as PKCS#12, which is what openssl produced', () => {
    const out = injectSigningConfig(TEMPLATE, ENV);
    expect(out).toContain("storeType 'PKCS12'");
    expect(out).toContain("storeFile file('/tmp/driftora-release.p12')");
    expect(out).toContain("keyAlias 'driftora'");
  });

  it('escapes the password instead of ending the Groovy string early', () => {
    // A generated password contains whatever base64 gives; a quote or backslash
    // must not turn into syntax. Silent truncation here would sign with a
    // DIFFERENT password and fail only at the Gradle step, hours later.
    const out = injectSigningConfig(TEMPLATE, { ...ENV, storePassword: "a'b\\c" });
    expect(out).toContain("storePassword 'a\\'b\\\\c'");
  });

  it('refuses to touch a template it does not recognise', () => {
    // Better a failed build than a green one that shipped the debug key.
    expect(() => injectSigningConfig('android { }', ENV)).toThrow(/signingConfigs/);
    expect(() =>
      injectSigningConfig('android { signingConfigs { } buildTypes { release { } } }', ENV),
    ).toThrow(/signingConfigs\.debug/);
  });
});
