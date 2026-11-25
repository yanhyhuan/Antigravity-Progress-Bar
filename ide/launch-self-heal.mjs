// Standalone Antigravity IDE renderer-port liveness probe and launch-flag self-heal coordinator.
import { join } from 'node:path';
import {
  DEBUG_ARGS,
  IDE_MACOS_LAUNCHER_NAME,
  ensureIdeLaunchConfig,
  inspectIdeLaunch,
  probeActiveDebugPort,
} from '../compat/launch-config.mjs';

const FLAGS_TEXT = DEBUG_ARGS.join(' ');
const ACTION_REPAIR = 'Repair Launch Flags';
const ACTION_AUTO_REPAIR = 'Always Auto-Repair';
const ACTION_MANUAL = 'Show Instructions';

function restartHint(platform = process.platform) {
  if (platform === 'darwin') {
    return `Fully quit Antigravity IDE (Command+Q), then open "${IDE_MACOS_LAUNCHER_NAME}" from ~/Applications.`;
  }
  return 'Fully quit and reopen Antigravity IDE from your shortcut or launcher to activate the inline status bar.';
}

function portDiagnosticMessage(probe) {
  if (probe.status === 'stale') {
    return `Stale DevToolsActivePort detected (127.0.0.1:${probe.port} is not listening). An IDE upgrade or normal launch likely started without ${FLAGS_TEXT}.`;
  }
  if (probe.status === 'invalid') {
    return `DevToolsActivePort is unreadable or malformed; start Antigravity IDE with ${FLAGS_TEXT}.`;
  }
  return `Renderer debugging endpoint unavailable (DevToolsActivePort missing). Start Antigravity IDE with ${FLAGS_TEXT}.`;
}

export async function ensureIdeRendererReady({
  profile,
  appResources = null,
  dataDir = null,
  mode = 'prompt',
  platform = process.platform,
  probePort = probeActiveDebugPort,
  inspectLaunch = inspectIdeLaunch,
  ensureLaunch = ensureIdeLaunchConfig,
  ui = {},
} = {}) {
  const log = typeof ui.log === 'function' ? ui.log : () => {};
  const showOutput = typeof ui.showOutput === 'function' ? ui.showOutput : () => {};
  const showInfo = typeof ui.showInfo === 'function' ? ui.showInfo : async () => undefined;
  const showWarning = typeof ui.showWarning === 'function' ? ui.showWarning : async () => undefined;
  const saveAutoMode = typeof ui.saveAutoMode === 'function' ? ui.saveAutoMode : async () => {};

  const probe = await probePort(profile);
  if (probe.status === 'alive') {
    return { ready: true, status: 'alive', port: probe.port, message: null };
  }

  const normalizedMode = ['auto', 'prompt', 'off'].includes(mode) ? mode : 'prompt';
  const settingsPath = dataDir ? join(dataDir, 'launch-settings.json') : undefined;
  const baseMessage = portDiagnosticMessage(probe);
  log(baseMessage);

  const launch = await inspectLaunch({ platform }).catch(() => ({ configured: false, supported: false, entrypoints: [] }));
  if (launch.configured) {
    const msg = `${probe.status === 'stale' ? 'Detected a stale IDE debug port.' : 'IDE started without remote debugging enabled.'} Launch flags are already configured — ${restartHint(platform)}`;
    log(msg);
    const picked = await showWarning(msg, ACTION_MANUAL);
    if (picked === ACTION_MANUAL) showOutput();
    return { ready: false, status: probe.status, port: probe.port, reason: 'restart-required', launch, message: msg };
  }

  const runRepair = async () => {
    const repaired = await ensureLaunch({ platform, settingsPath, appResources, profile }).catch(() => ({
      configured: false,
      repaired: false,
      supported: launch.supported,
      entrypoints: [],
    }));
    if (repaired.configured) {
      const msg = `Antigrative Dashboard configured Antigravity IDE launch flags (${repaired.entrypoints.length} entry point${repaired.entrypoints.length === 1 ? '' : 's'}). ${restartHint(platform)}`;
      log(msg);
      await showInfo(msg);
      return { ready: false, status: probe.status, port: probe.port, reason: 'repaired-restart-required', launch: repaired, message: msg };
    }
    const msg = `Could not automatically locate a writable Antigravity IDE shortcut/launcher. Fully quit the IDE and start it with ${FLAGS_TEXT}. See the extension README.`;
    log(msg);
    const picked = await showWarning(msg, ACTION_MANUAL);
    if (picked === ACTION_MANUAL) showOutput();
    return { ready: false, status: probe.status, port: probe.port, reason: 'manual-config-required', launch: repaired, message: msg };
  };

  if (launch.supported && normalizedMode === 'auto') {
    return runRepair();
  }

  if (launch.supported && normalizedMode === 'prompt') {
    const promptText = probe.status === 'stale'
      ? 'Antigravity IDE appears to have restarted or updated without loopback debugging flags (stale DevToolsActivePort detected). Repair IDE launch flags now?'
      : 'Antigrative Dashboard needs loopback debugging flags on your Antigravity IDE shortcut/launcher. Repair IDE launch flags now?';
    const choice = await showInformationOrWarning(showWarning, promptText, ACTION_REPAIR, ACTION_AUTO_REPAIR, ACTION_MANUAL);
    if (choice === ACTION_AUTO_REPAIR) {
      await Promise.resolve().then(() => saveAutoMode('auto')).catch(() => {});
      return runRepair();
    }
    if (choice === ACTION_REPAIR) {
      return runRepair();
    }
    if (choice === ACTION_MANUAL) {
      log(`Manual launch command flags: ${FLAGS_TEXT}`);
      showOutput();
    }
    return { ready: false, status: probe.status, port: probe.port, reason: 'debug-port-disabled', launch, message: baseMessage };
  }

  const manualMsg = `${baseMessage} See the extension README.`;
  const picked = await showWarning(manualMsg, ACTION_MANUAL);
  if (picked === ACTION_MANUAL) showOutput();
  return { ready: false, status: probe.status, port: probe.port, reason: 'debug-port-disabled', launch, message: manualMsg };
}

async function showInformationOrWarning(fn, message, ...actions) {
  return fn(message, ...actions);
}

export async function maybeRepairLaunchInBackground({
  profile,
  appResources = null,
  dataDir = null,
  mode = 'prompt',
  platform = process.platform,
  inspectLaunch = inspectIdeLaunch,
  ensureLaunch = ensureIdeLaunchConfig,
  ui = {},
} = {}) {
  if (mode !== 'auto') return { configured: false, repaired: false, skipped: true };
  const log = typeof ui.log === 'function' ? ui.log : () => {};
  const settingsPath = dataDir ? join(dataDir, 'launch-settings.json') : undefined;
  const status = await inspectLaunch({ platform }).catch(() => ({ configured: true, supported: false, entrypoints: [] }));
  if (status.configured || !status.supported) return { ...status, repaired: false };
  const repaired = await ensureLaunch({ platform, settingsPath, appResources, profile }).catch(() => ({
    configured: false,
    repaired: false,
    supported: true,
    entrypoints: [],
  }));
  if (repaired.repaired) {
    log(`Restored Antigravity IDE launch flags after upgrade (${repaired.entrypoints.length} entry point${repaired.entrypoints.length === 1 ? '' : 's'}).`);
  }
  return repaired;
}

export async function runManualLaunchRepair({
  profile,
  appResources = null,
  dataDir = null,
  platform = process.platform,
  ensureLaunch = ensureIdeLaunchConfig,
  ui = {},
} = {}) {
  const log = typeof ui.log === 'function' ? ui.log : () => {};
  const showInfo = typeof ui.showInfo === 'function' ? ui.showInfo : async () => undefined;
  const showWarning = typeof ui.showWarning === 'function' ? ui.showWarning : async () => undefined;
  const showOutput = typeof ui.showOutput === 'function' ? ui.showOutput : () => {};
  const settingsPath = dataDir ? join(dataDir, 'launch-settings.json') : undefined;

  const result = await ensureLaunch({ platform, settingsPath, appResources, profile }).catch(() => ({
    configured: false,
    repaired: false,
    supported: false,
    entrypoints: [],
  }));
  if (result.configured) {
    const msg = result.repaired
      ? `Repaired Antigravity IDE launch flags (${result.entrypoints.length} entry point${result.entrypoints.length === 1 ? '' : 's'}). ${restartHint(platform)}`
      : `Antigravity IDE launch flags are already configured (${result.entrypoints.length} entry point${result.entrypoints.length === 1 ? '' : 's'}). ${restartHint(platform)}`;
    log(msg);
    await showInfo(msg);
    return result;
  }
  const msg = `Could not automatically repair Antigravity IDE launch flags. Fully quit the IDE and start it with ${FLAGS_TEXT}.`;
  log(msg);
  const picked = await showWarning(msg, ACTION_MANUAL);
  if (picked === ACTION_MANUAL) showOutput();
  return result;
}
