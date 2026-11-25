import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESKTOP_MANAGED_MARKER,
  IDE_MACOS_LAUNCHER_NAME,
  MACOS_MANAGED_PLIST_KEY,
  ensureIdeLaunchConfig,
  inspectIdeLaunch,
  isAntigravityDesktopShortcut,
  isAntigravityIdeShortcut,
  parseLnkBuffer,
  probeActiveDebugPort,
} from '../../compat/launch-config.mjs';
import {
  ensureIdeRendererReady,
  maybeRepairLaunchInBackground,
  runManualLaunchRepair,
} from '../launch-self-heal.mjs';

function buildLnk(target, args = '', icon = '') {
  let flags = 0x02 | 0x80;
  if (args) flags |= 0x20;
  if (icon) flags |= 0x40;
  const hdr = Buffer.alloc(76);
  hdr.writeUInt32LE(0x4c, 0);
  hdr.writeUInt32LE(flags, 0x14);
  const ansi = Buffer.from(target + '\0', 'latin1');
  const uni = Buffer.from(target + '\0', 'utf16le');
  const infoHdrLen = 0x24;
  const lbOff = infoHdrLen;
  const ubOff = lbOff + ansi.length;
  const infoLen = ubOff + uni.length;
  const infoHdr = Buffer.alloc(36);
  infoHdr.writeUInt32LE(infoLen, 0);
  infoHdr.writeUInt32LE(infoHdrLen, 4);
  infoHdr.writeUInt32LE(0x01, 8);
  infoHdr.writeUInt32LE(lbOff, 16);
  infoHdr.writeUInt32LE(ubOff, 28);
  const strParts = [];
  for (const [flag, val] of [[0x20, args], [0x40, icon]]) {
    if (flags & flag) {
      const lenBuf = Buffer.alloc(2);
      lenBuf.writeUInt16LE(val.length, 0);
      strParts.push(lenBuf, Buffer.from(val, 'utf16le'));
    }
  }
  return Buffer.concat([hdr, infoHdr, ansi, uni, ...strParts]);
}

test('isAntigravityIdeShortcut matches IDE shortcuts only and stays disjoint from Desktop App shortcuts', () => {
  const ideDirect = { target: 'D:\\Antigravity IDE\\Antigravity IDE.exe', args: '', icon: '' };
  const ideProxy = { target: 'C:\\Tools\\AntigravityProxy.exe', args: '--ide', icon: 'D:\\IDE\\Antigravity IDE.exe' };
  const appDirect = { target: 'C:\\Apps\\Antigravity.exe', args: '', icon: '' };
  const appProxy = { target: 'C:\\Tools\\AntigravityLauncher.exe', args: '', icon: 'C:\\Apps\\Antigravity.exe' };

  assert.equal(isAntigravityIdeShortcut('C:\\Start\\Antigravity IDE.lnk', ideDirect), true);
  assert.equal(isAntigravityDesktopShortcut('C:\\Start\\Antigravity IDE.lnk', ideDirect), false);

  assert.equal(isAntigravityIdeShortcut('C:\\Desktop\\Antigravity IDE (Proxy).lnk', ideProxy), true);
  assert.equal(isAntigravityDesktopShortcut('C:\\Desktop\\Antigravity IDE (Proxy).lnk', ideProxy), false);

  assert.equal(isAntigravityIdeShortcut('C:\\Desktop\\Antigravity.lnk', appDirect), false);
  assert.equal(isAntigravityIdeShortcut('C:\\Desktop\\Antigravity (Proxy).lnk', appProxy), false);
});

test('probeActiveDebugPort distinguishes alive, stale, missing and malformed DevToolsActivePort files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-ide-port-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.deepEqual(await probeActiveDebugPort(dir), { status: 'missing', port: null });

  await writeFile(join(dir, 'DevToolsActivePort'), 'not-a-port\n/devtools/browser/1\n');
  assert.deepEqual(await probeActiveDebugPort(dir), { status: 'invalid', port: null });

  const server = createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const livePort = server.address().port;

  await writeFile(join(dir, 'DevToolsActivePort'), `${livePort}\n/devtools/browser/1\n`);
  assert.deepEqual(await probeActiveDebugPort(dir), { status: 'alive', port: livePort });

  // Close the server while leaving DevToolsActivePort on disk (simulates IDE upgrade clearing flags).
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(await probeActiveDebugPort(dir), { status: 'stale', port: livePort });
});

test('ensureIdeLaunchConfig repairs overwritten Windows IDE shortcuts, Linux desktop files and macOS launchers', async t => {
  // Windows
  const winHome = await mkdtemp(join(tmpdir(), 'ag-ide-win-'));
  t.after(() => rm(winHome, { recursive: true, force: true }));
  const startMenu = join(winHome, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const settingsPath = join(winHome, 'launch-settings.json');
  await mkdir(startMenu, { recursive: true });
  const ideLnk = join(startMenu, 'Antigravity IDE.lnk');
  const appLnk = join(startMenu, 'Antigravity.lnk');
  await writeFile(ideLnk, buildLnk('D:\\Antigravity IDE\\Antigravity IDE.exe', ''));
  await writeFile(appLnk, buildLnk('C:\\Apps\\Antigravity.exe', ''));

  const updatedPaths = [];
  const execPowerShell = async updates => {
    for (const item of updates) {
      updatedPaths.push(item.path);
      const info = parseLnkBuffer(await readFile(item.path));
      await writeFile(item.path, buildLnk(info.target, item.args, info.icon || ''));
    }
  };

  const before = await inspectIdeLaunch({ platform: 'win32', home: winHome, env: {} });
  assert.equal(before.configured, false);
  assert.deepEqual(before.entrypoints, [ideLnk]);

  const repaired = await ensureIdeLaunchConfig({ platform: 'win32', home: winHome, env: {}, settingsPath, execPowerShell });
  assert.deepEqual(repaired, { configured: true, repaired: true, supported: true, entrypoints: [ideLnk] });
  assert.deepEqual(updatedPaths, [ideLnk], 'Must not modify Desktop App shortcuts');
  assert.equal(parseLnkBuffer(await readFile(ideLnk)).args, '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1');
  assert.equal(parseLnkBuffer(await readFile(appLnk)).args, undefined);
  const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.deepEqual(saved.managedIdeLaunch.windowsShortcuts[ideLnk], ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']);

  // Zero-subprocess fast path on repeat call
  const fast = await ensureIdeLaunchConfig({ platform: 'win32', home: winHome, env: {}, settingsPath, execPowerShell });
  assert.equal(fast.repaired, false);
  assert.equal(updatedPaths.length, 1);

  // Linux
  const linuxRoot = await mkdtemp(join(tmpdir(), 'ag-ide-linux-'));
  t.after(() => rm(linuxRoot, { recursive: true, force: true }));
  const linuxHome = join(linuxRoot, 'home');
  const sysApps = join(linuxRoot, 'sys');
  await mkdir(sysApps, { recursive: true });
  await writeFile(join(sysApps, 'antigravity-ide.desktop'), '[Desktop Entry]\nName=Antigravity IDE\nExec=/opt/antigravity-ide/antigravity-ide %F\n');
  const linuxRepaired = await ensureIdeLaunchConfig({ platform: 'linux', home: linuxHome, env: {}, systemDirs: [sysApps] });
  assert.equal(linuxRepaired.configured, true);
  assert.equal(linuxRepaired.repaired, true);
  const linuxFile = join(linuxHome, '.local', 'share', 'applications', 'antigravity-ide.desktop');
  const linuxText = await readFile(linuxFile, 'utf8');
  assert.ok(linuxText.includes('--remote-debugging-port=0 --remote-debugging-address=127.0.0.1 %F'));
  assert.ok(linuxText.includes(DESKTOP_MANAGED_MARKER));

  // macOS
  const macRoot = await mkdtemp(join(tmpdir(), 'ag-ide-mac-'));
  t.after(() => rm(macRoot, { recursive: true, force: true }));
  const macHome = join(macRoot, 'home');
  const macApps = join(macRoot, 'Applications');
  const targetApp = join(macApps, 'Antigravity IDE.app');
  await mkdir(join(targetApp, 'Contents', 'MacOS'), { recursive: true });
  await mkdir(join(targetApp, 'Contents', 'Resources', 'app'), { recursive: true });
  await writeFile(join(targetApp, 'Contents', 'MacOS', 'Antigravity IDE'), 'bin');
  await writeFile(join(targetApp, 'Contents', 'Resources', 'app', 'product.json'), '{"applicationName":"antigravity-ide"}');
  const macRepaired = await ensureIdeLaunchConfig({
    platform: 'darwin',
    home: macHome,
    env: {},
    appResources: join(targetApp, 'Contents', 'Resources'),
    profile: join(macHome, 'Library', 'Application Support', 'Antigravity IDE'),
    systemAppDirs: [macApps],
  });
  const bundle = join(macHome, 'Applications', IDE_MACOS_LAUNCHER_NAME);
  assert.deepEqual(macRepaired, { configured: true, repaired: true, supported: true, entrypoints: [bundle] });
  assert.ok((await readFile(join(bundle, 'Contents', 'Info.plist'), 'utf8')).includes(MACOS_MANAGED_PLIST_KEY));
  assert.ok((await readFile(join(bundle, 'Contents', 'MacOS', 'launcher'), 'utf8')).includes('--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'));
});

test('ensureIdeRendererReady handles stale ports with prompt, auto and off self-heal policies cleanly', async () => {
  const logs = [];
  let savedMode = null;
  let repairedCount = 0;

  // 1. Prompt mode + user picks "Always Auto-Repair"
  const res1 = await ensureIdeRendererReady({
    profile: 'fixture',
    mode: 'prompt',
    platform: 'win32',
    probePort: async () => ({ status: 'stale', port: 54321 }),
    inspectLaunch: async () => ({ configured: false, supported: true, entrypoints: ['ide.lnk'] }),
    ensureLaunch: async () => { repairedCount++; return { configured: true, repaired: true, supported: true, entrypoints: ['ide.lnk'] }; },
    ui: {
      log: m => logs.push(m),
      showWarning: async (_msg, _r, autoBtn) => autoBtn,
      showInfo: async () => undefined,
      saveAutoMode: async m => { savedMode = m; },
    },
  });
  assert.equal(res1.ready, false);
  assert.equal(res1.reason, 'repaired-restart-required');
  assert.equal(savedMode, 'auto');
  assert.equal(repairedCount, 1);
  assert.ok(logs.some(m => m.includes('Stale DevToolsActivePort')));

  // 2. Auto mode repairs without asking confirmation
  let warnings = 0;
  const res2 = await ensureIdeRendererReady({
    profile: 'fixture',
    mode: 'auto',
    platform: 'win32',
    probePort: async () => ({ status: 'missing', port: null }),
    inspectLaunch: async () => ({ configured: false, supported: true, entrypoints: ['ide.lnk'] }),
    ensureLaunch: async () => { repairedCount++; return { configured: true, repaired: true, supported: true, entrypoints: ['ide.lnk'] }; },
    ui: { showWarning: async () => { warnings++; }, showInfo: async () => undefined },
  });
  assert.equal(res2.reason, 'repaired-restart-required');
  assert.equal(warnings, 0);
  assert.equal(repairedCount, 2);

  // 3. Off mode never modifies shortcuts
  const res3 = await ensureIdeRendererReady({
    profile: 'fixture',
    mode: 'off',
    platform: 'win32',
    probePort: async () => ({ status: 'stale', port: 54321 }),
    inspectLaunch: async () => ({ configured: false, supported: true, entrypoints: ['ide.lnk'] }),
    ensureLaunch: async () => { throw new Error('must not run in off mode'); },
    ui: { showWarning: async () => undefined },
  });
  assert.equal(res3.ready, false);
  assert.equal(res3.reason, 'debug-port-disabled');

  // 4. Alive port returns ready immediately and background repair only runs in auto mode
  const res4 = await ensureIdeRendererReady({
    profile: 'fixture',
    mode: 'auto',
    probePort: async () => ({ status: 'alive', port: 9000 }),
  });
  assert.deepEqual(res4, { ready: true, status: 'alive', port: 9000, message: null });

  const bgSkip = await maybeRepairLaunchInBackground({ profile: 'fixture', mode: 'prompt' });
  assert.equal(bgSkip.skipped, true);

  const bgAuto = await maybeRepairLaunchInBackground({
    profile: 'fixture',
    mode: 'auto',
    inspectLaunch: async () => ({ configured: false, supported: true, entrypoints: ['ide.lnk'] }),
    ensureLaunch: async () => ({ configured: true, repaired: true, supported: true, entrypoints: ['ide.lnk'] }),
  });
  assert.equal(bgAuto.repaired, true);

  const manual = await runManualLaunchRepair({
    profile: 'fixture',
    ensureLaunch: async () => ({ configured: true, repaired: true, supported: true, entrypoints: ['ide.lnk'] }),
  });
  assert.equal(manual.configured, true);
});
