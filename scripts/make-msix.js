'use strict';
/*
 * Packs dist/win-unpacked into a Store-ready .msix.
 *
 * Why not electron-builder's appx target: it shells out to a 2019 makeappx.exe bundled in
 * its winCodeSign vendor package, and that binary cannot resolve its own side-by-side
 * assemblies from inside the electron-builder cache directory. It dies with a bare
 * "spawn UNKNOWN". The same tool from the Windows SDK works, so this script fetches the SDK
 * build tools from NuGet (no admin, no installer) and drives makeappx directly.
 *
 * The package is left unsigned on purpose: the Store re-signs it during certification,
 * which is the whole reason for shipping MSIX rather than an EXE installer.
 *
 *   node scripts/make-msix.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const appx = (pkg.build && pkg.build.appx) || {};

const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');
const STAGING = path.join(ROOT, 'dist', 'msix-staging');
const TILES = path.join(ROOT, 'build', 'appx');
const SDK_DIR = path.join(ROOT, 'build', 'sdk-tools');
const OUT = path.join(ROOT, 'dist', `${pkg.build.productName}-${pkg.version}.msix`);

const NUGET_URL = 'https://www.nuget.org/api/v2/package/Microsoft.Windows.SDK.BuildTools/';

/* ------------------------------------------------------------------ */

function fail(msg) {
  console.error('\nmake-msix: ' + msg + '\n');
  process.exit(1);
}

function ps(script) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

/** makeappx.exe from the SDK build tools, downloading them on first run. */
function findMakeAppx() {
  const search = () => {
    const hits = [];
    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.toLowerCase() === 'makeappx.exe' && path.basename(dir) === 'x64') {
          hits.push(full);
        }
      }
    };
    walk(SDK_DIR);
    return hits[0] || null;
  };

  let exe = search();
  if (exe) return exe;

  console.log('make-msix: fetching Windows SDK build tools from NuGet (one time)...');
  fs.mkdirSync(SDK_DIR, { recursive: true });
  const zip = path.join(SDK_DIR, 'sdk-buildtools.zip');
  ps(
    `Invoke-WebRequest -Uri '${NUGET_URL}' -OutFile '${zip}' -UseBasicParsing; ` +
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${path.join(SDK_DIR, 'extracted')}' -Force`
  );
  exe = search();
  if (!exe) fail('could not find makeappx.exe in the downloaded SDK build tools');
  return exe;
}

/* ------------------------------------------------------------------ */

function buildManifest(exeName) {
  const required = ['identityName', 'publisher', 'publisherDisplayName'];
  for (const key of required) {
    const v = appx[key];
    if (!v || String(v).includes('REPLACE_WITH')) {
      fail(
        `build.appx.${key} is not set in package.json.\n` +
          '  Copy the value from Partner Center: Product management > Product identity.'
      );
    }
  }

  // MSIX versions are four part and the Store requires the revision to be 0.
  const version = `${pkg.version.split('-')[0]}.0`;
  // Must be one of the names reserved in Partner Center, or the upload is rejected.
  const display = appx.displayName || pkg.build.productName;
  const description = pkg.description || display;
  const startupId = appx.identityName.replace(/[^A-Za-z0-9]/g, '') + 'Startup';

  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap5 rescap">

  <Identity
    Name="${appx.identityName}"
    Publisher="${appx.publisher}"
    Version="${version}"
    ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>${display}</DisplayName>
    <PublisherDisplayName>${appx.publisherDisplayName}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>

  <Applications>
    <Application Id="App" Executable="${exeName}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${display}"
        Description="${description}"
        BackgroundColor="${appx.backgroundColor || '#0f1420'}"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" />
      </uap:VisualElements>
      <Extensions>
        <!-- MSIX cannot use the registry Run key, so start at login is declared here and
             the user toggles it in Windows Settings > Apps > Startup. -->
        <uap5:Extension Category="windows.startupTask" Executable="${exeName}" EntryPoint="Windows.FullTrustApplication">
          <uap5:StartupTask TaskId="${startupId}" Enabled="false" DisplayName="${display}" />
        </uap5:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
`;
}

/* ------------------------------------------------------------------ */

if (!fs.existsSync(UNPACKED)) {
  fail('dist/win-unpacked is missing. Run:  npm run store');
}

const exeName = fs
  .readdirSync(UNPACKED)
  .find((n) => n.toLowerCase().endsWith('.exe') && !n.toLowerCase().includes('unins'));
if (!exeName) fail('no .exe found in dist/win-unpacked');

for (const tile of [
  'StoreLogo.png',
  'Square150x150Logo.png',
  'Square44x44Logo.png',
  'Wide310x150Logo.png',
]) {
  if (!fs.existsSync(path.join(TILES, tile))) {
    fail(`build/appx/${tile} is missing. Run:  npm run icon`);
  }
}

console.log(`make-msix: app executable is ${exeName}`);

fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });
fs.cpSync(UNPACKED, STAGING, { recursive: true });
fs.mkdirSync(path.join(STAGING, 'Assets'), { recursive: true });
fs.cpSync(TILES, path.join(STAGING, 'Assets'), { recursive: true });
fs.writeFileSync(path.join(STAGING, 'AppxManifest.xml'), buildManifest(exeName));
console.log('make-msix: staging tree ready');

const makeappx = findMakeAppx();
console.log(`make-msix: using ${path.relative(ROOT, makeappx)}`);

fs.rmSync(OUT, { force: true });
try {
  const out = execFileSync(makeappx, ['pack', '/d', STAGING, '/p', OUT, '/o'], {
    encoding: 'utf8',
    cwd: path.dirname(makeappx), // side-by-side assemblies must resolve from the tool's dir
  });
  console.log(out.trim().split('\n').slice(-3).join('\n'));
} catch (err) {
  console.error(err.stdout || '');
  console.error(err.stderr || '');
  fail('makeappx failed, see output above');
}

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`\nmake-msix: wrote ${path.relative(ROOT, OUT)} (${mb} MB)`);
console.log('Upload this file on the Packages page in Partner Center. It is unsigned by');
console.log('design: the Store signs it during certification.');
