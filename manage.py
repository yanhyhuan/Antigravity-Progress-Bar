"""Dependency-free Antigrative Dashboard installer, switch, uninstaller and packager."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from functools import wraps

SOURCE = Path(__file__).resolve().parent
_path_spec = importlib.util.spec_from_file_location('pulse_paths', SOURCE / 'compat' / 'platform_paths.py')
_paths_module = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_paths_module)
_paths = _paths_module.platform_paths()
HOME = _paths['home']
LOCAL = _paths['local']
PLUGIN = HOME / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse'
CONFIG = HOME / '.gemini' / 'config' / 'config.json'
SETTINGS = _paths['settings']
APP = _paths['app']
BACKUPS = _paths['backups']
RUNTIME_FILES = ('assets', 'compat', 'sidecars', 'hooks', 'sounds', 'plugin.json', 'hooks.json')
DIST_FILES = ('plugin.json', 'hooks.json', 'assets', 'sidecars', 'compat', 'hooks', 'sounds', 'cli', 'ide', 'manage.py', 'install.ps1',
              'uninstall.ps1', 'install.sh', 'uninstall.sh', 'README.md', 'LICENSE', 'CHANGELOG.md', 'COMPATIBILITY.md', 'docs', 'package.json',
              '.gitignore', '.gitattributes', 'tests', 'tools', 'GITHUB_RELEASE.md')
IGNORED = {'__pycache__', '.data', 'node_modules', '.git', 'dist', 'data', 'history-v1', 'usage-v1', 'sdk'}

def lifecycle_operation(function):
    @wraps(function)
    def locked(*args, **kwargs):
        spec = importlib.util.spec_from_file_location('pulse_update_lock', SOURCE / 'compat/update-lock.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with module.lifecycle_lock(PLUGIN):
            transaction = PLUGIN.parent / '.antigravity-pulse-update-transaction'
            if (transaction / 'journal.json').exists():
                raise RuntimeError('An interrupted update requires recovery. Run the saved recover.py helper before installing or uninstalling.')
            return function(*args, **kwargs)
    return locked

def json_read(file, default=None):
    if not file.exists():
        return {} if default is None else default
    return json.loads(file.read_text(encoding='utf-8-sig'))

def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, file)

def own_plugin():
    if PLUGIN.is_symlink() or (PLUGIN.exists() and PLUGIN.resolve().parent != (HOME / '.gemini' / 'config' / 'plugins').resolve()):
        raise RuntimeError('Plugin destination must be a regular directory inside the customization root.')
    if PLUGIN.exists() and json_read(PLUGIN / 'plugin.json').get('name') != 'antigravity-pulse':
        raise RuntimeError('Destination is not an Antigrative Dashboard installation; refusing to overwrite it.')

def adapter():
    spec = importlib.util.spec_from_file_location('pulse_adapter', SOURCE / 'compat' / 'patch-loader.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.APP = APP
    module.BACKUPS = BACKUPS
    return module

def launch_config():
    spec = importlib.util.spec_from_file_location('pulse_launch_config', SOURCE / 'compat' / 'launch_config.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def original_for_current(current):
    digest = hashlib.sha256(current).hexdigest()
    if not BACKUPS.exists():
        return None
    for directory in sorted(BACKUPS.iterdir(), reverse=True):
        note = json_read(directory / 'patch.json')
        if note.get('patchedSha256') == digest:
            original = (directory / 'app.asar').read_bytes()
            if hashlib.sha256(original).hexdigest() != note.get('originalSha256'):
                raise RuntimeError('Original application backup failed its integrity check.')
            return original
    return None

def set_enabled(enabled):
    own_plugin()
    if not (PLUGIN / 'plugin.json').exists():
        raise RuntimeError('Install Antigrative Dashboard before changing its state.')
    config = json_read(CONFIG)
    entry = config.setdefault('plugins', {}).setdefault('antigravity-pulse', {})
    entry['enabled'] = bool(enabled)
    atomic_json(CONFIG, config)
    settings = json_read(SETTINGS)
    settings['enabled'] = bool(enabled)
    atomic_json(SETTINGS, settings)
    print('Antigrative Dashboard enabled.' if enabled else 'Antigrative Dashboard disabled; the toolbar hides on its next poll.')

def remove_verified_legacy_adapter():
    if not APP.is_file():
        return
    current = APP.read_bytes()
    original = original_for_current(current)
    if original is not None:
        APP.write_bytes(original)
        if APP.read_bytes() != original:
            raise RuntimeError('Legacy adapter restoration verification failed.')
        print('Restored the exact verified legacy archive; future updates need no archive patches.')
    elif b'// AG_PULSE_INLINE_V1' in current:
        raise RuntimeError('The legacy adapter has unknown app changes; refusing to overwrite them. Inspect its backup first.')


@lifecycle_operation
def install(panel_only=False, legacy_loader=False):
    own_plugin()
    config = json_read(CONFIG)
    if not isinstance(config, dict) or not isinstance(config.get('plugins', {}), dict):
        raise RuntimeError('Existing customization configuration has an incompatible shape.')
    if not panel_only:
        if not APP.is_file():
            raise RuntimeError('Antigravity desktop app not found. Use --app-path /path/to/resources/app.asar for a custom installation. See COMPATIBILITY.md.')
    if legacy_loader:
        if sys.platform != 'win32':
            raise RuntimeError('The historical app.asar loader is Windows-only. Use the default runtime adapter.')
        module = adapter()
        module.build(module.unpatched_original(APP.read_bytes()))
    elif not panel_only:
        remove_verified_legacy_adapter()
    PLUGIN.mkdir(parents=True, exist_ok=True)
    for name in RUNTIME_FILES:
        source, target = SOURCE / name, PLUGIN / name
        if source.resolve() == target.resolve():
            continue
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.log', '.data', 'node_modules', 'data', 'history-v1', 'sdk'))
        else:
            shutil.copy2(source, target)
    default_notify = SOURCE / 'hooks' / 'default-settings.json'
    user_notify = PLUGIN / 'notify-settings.json'
    if default_notify.is_file() and not user_notify.exists():
        shutil.copy2(default_notify, user_notify)
    if legacy_loader:
        subprocess.run([sys.executable, str(SOURCE / 'compat' / 'patch-loader.py'), '--apply'], check=True,
                       env={**os.environ, 'AG_PULSE_APP_ASAR': str(APP)})
    settings = json_read(SETTINGS)
    settings.update({'inline': not panel_only, 'mode': 'legacy' if legacy_loader else 'runtime'})
    if APP.is_file():
        settings['appResources'] = str(APP.parent)
    if os.environ.get('AG_PULSE_PROFILE'):
        settings['profile'] = str(_paths['profile'])
    lc = launch_config()
    launch_result = {'configured': False, 'supported': False, 'entrypoints': []}
    if not panel_only and not legacy_loader:
        launch_result, managed = lc.configure_desktop_launch(
            home=HOME, local=LOCAL, managed=settings.get('managedLaunch'),
            app_asar=APP, profile=_paths['profile'],
        )
    else:
        managed = lc.remove_desktop_launch(home=HOME, local=LOCAL, managed=settings.get('managedLaunch'))
    if managed:
        settings['managedLaunch'] = managed
    else:
        settings.pop('managedLaunch', None)
    atomic_json(SETTINGS, settings)
    set_enabled(True)
    host = lc.inspect_host_archive(APP)
    print('Installed:', PLUGIN)
    if not panel_only and not legacy_loader and launch_result['configured']:
        print('Configured Antigravity launch entry points with loopback debugging flags:', ', '.join(launch_result['entrypoints']))
        if sys.platform == 'darwin':
            print('Fully quit Antigravity (Command+Q), then open "Antigravity (Dashboard)" from ~/Applications (Spotlight / Dock) to start with the inline widget.')
        else:
            print('Fully quit and reopen Antigravity from your shortcut/launcher to start the plugin runtime. App updates no longer overwrite the inline adapter.')
    elif not panel_only and not legacy_loader and host['requiresDebugFlag']:
        print('Note: Antigravity', host['version'] or '2.33+', 'requires --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 for the inline widget.')
        print('Fully quit Antigravity and run `python manage.py launch` (or `python3 manage.py launch`) to start with the inline widget.')
    else:
        print('Fully quit and reopen Antigravity to start the plugin runtime. App updates no longer overwrite the inline adapter.')

@lifecycle_operation
def uninstall():
    own_plugin()
    # Restore before deleting the runtime. An unknown archive is never overwritten.
    if APP.exists():
        module = adapter()
        current = APP.read_bytes()
        original = original_for_current(current)
        if original is not None:
            APP.write_bytes(original)
            if APP.read_bytes() != original:
                raise RuntimeError('Restored application verification failed.')
            print('Original Antigravity archive restored.')
        elif b'// AG_PULSE_INLINE_V1' in current:
            header, base = module.archive(current)
            entry = header['files']['dist']['files']['preload.js']
            preload = current[base + int(entry['offset']):base + int(entry['offset']) + entry['size']]
            if module.MARKER.encode() in preload:
                raise RuntimeError('Application changed since patching. Inspect the backup before uninstalling.')
    settings = json_read(SETTINGS)
    lc = launch_config()
    try:
        managed = lc.remove_desktop_launch(home=HOME, local=LOCAL, managed=settings.get('managedLaunch'))
    except (OSError, subprocess.CalledProcessError) as error:
        print(f'Warning: could not revert launch entry points ({error})', file=sys.stderr)
        managed = {}
    if PLUGIN.exists():
        set_enabled(False)
        settings = json_read(SETTINGS)
        settings['enabled'] = False
        if managed:
            settings['managedLaunch'] = managed
        else:
            settings.pop('managedLaunch', None)
        atomic_json(SETTINGS, settings)
        resolved = PLUGIN.resolve()
        expected_parent = (HOME / '.gemini' / 'config' / 'plugins').resolve()
        if PLUGIN.is_symlink() or resolved.parent != expected_parent or resolved.name != 'antigravity-pulse':
            raise RuntimeError('Plugin target is outside the expected directory; refusing to delete it.')
        shutil.rmtree(resolved)
    else:
        settings['enabled'] = False
        if managed:
            settings['managedLaunch'] = managed
        else:
            settings.pop('managedLaunch', None)
        atomic_json(SETTINGS, settings)
    print('Antigrative Dashboard removed. Backups and diagnostic logs are retained for recovery.')
    print('Fully quit and reopen Antigravity to unload the UI adapter.')

def _resolved_app_and_profile(settings=None, explicit_app=False):
    settings = json_read(SETTINGS) if settings is None else settings
    app = APP
    if not explicit_app and not app.is_file() and isinstance(settings.get('appResources'), str) and settings['appResources']:
        candidate = Path(settings['appResources']).expanduser() / 'app.asar'
        if candidate.is_file():
            app = candidate
    if os.environ.get('AG_PULSE_PROFILE'):
        profile = Path(os.environ['AG_PULSE_PROFILE']).expanduser()
    elif isinstance(settings.get('profile'), str) and settings['profile']:
        profile = Path(settings['profile']).expanduser()
    else:
        profile = _paths['profile']
    return app, profile


def launch(workspace=None, exe=None, restart=False, spawn=subprocess.Popen, runner=subprocess.run,
           platform=None, open_binary='/usr/bin/open', explicit_app=False):
    lc = launch_config()
    target_platform = platform or sys.platform
    settings = json_read(SETTINGS)
    app_asar, profile = _resolved_app_and_profile(settings, explicit_app=explicit_app)
    if exe is not None:
        executable = Path(exe).expanduser().resolve()
        if not executable.is_file():
            raise RuntimeError(f'Antigravity desktop executable not found: {executable}')
    else:
        executable = lc.desktop_executable(app_asar, platform=target_platform)
        if executable is None or not executable.is_file():
            raise RuntimeError('Antigravity desktop app not found. Use --exe /path/to/Antigravity or --app-path /path/to/resources/app.asar.')
    bundle = lc.macos_app_bundle(executable) if target_platform == 'darwin' else None
    if target_platform == 'darwin':
        running = lc.running_desktop_pids(executable, platform=target_platform, runner=runner)
        if running:
            debug_ready = lc.has_active_debug_port(profile)
            if debug_ready and not restart:
                if workspace is not None and bundle is not None and (
                    open_binary is True or (isinstance(open_binary, (str, Path)) and Path(open_binary).is_file())
                ):
                    open_exe = '/usr/bin/open' if open_binary is True else str(open_binary)
                    env = dict(os.environ)
                    env.pop('ELECTRON_RUN_AS_NODE', None)
                    process = spawn(
                        [open_exe, '-a', str(bundle), str(Path(workspace).expanduser().resolve())],
                        env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        start_new_session=True,
                    )
                    print('Antigravity is already running with remote debugging enabled; opened workspace in existing instance.')
                    return process
                print('Antigravity is already running with remote debugging enabled.')
                return None
            if not restart:
                raise RuntimeError(
                    'Antigravity is already running without remote debugging enabled. '
                    'Fully quit it first (Command+Q), or re-run with --restart to quit and relaunch.'
                )
            if bundle is None or not lc.quit_macos_app(bundle, executable, runner=runner):
                raise RuntimeError(
                    'Antigravity did not finish quitting in time. Press Command+Q to quit it, then re-run launch.'
                )
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    args = lc.build_launch_command(
        executable, workspace=workspace, platform=target_platform,
        use_open=(exe is None), open_binary=open_binary,
    )
    options = dict(env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if target_platform == 'win32':
        options['creationflags'] = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    else:
        options['start_new_session'] = True
    process = spawn(args, **options)
    print('Launched Antigravity with loopback debugging flags:', bundle or executable)
    return process

def status(explicit_app=False):
    installed = (PLUGIN / 'plugin.json').is_file()
    enabled = installed and json_read(CONFIG).get('plugins', {}).get('antigravity-pulse', {}).get('enabled', True)
    health_file = HOME / '.gemini' / 'antigravity' / 'sidecar_data' / 'antigravity-pulse' / 'panel' / 'data' / 'integration-state.json'
    settings = json_read(SETTINGS)
    app_asar, _ = _resolved_app_and_profile(settings, explicit_app=explicit_app)
    lc = launch_config()
    host = lc.inspect_host_archive(app_asar)
    print(json.dumps({'installed': installed, 'enabled': bool(enabled), 'pluginDirectory': str(PLUGIN),
                      'integrationMode': settings.get('mode', 'legacy'),
                      'hostVersion': host['version'],
                      'hostRequiresDebugFlag': host['requiresDebugFlag'],
                      'launchConfiguration': lc.inspect_desktop_launch(home=HOME, local=LOCAL),
                      'inlineIntegration': json_read(health_file, None),
                      'toolbarAdapterRecoverable': app_asar.exists() and original_for_current(app_asar.read_bytes()) is not None}, indent=2))

BINARY_SUFFIXES = {'.png', '.mp3', '.webp', '.ico', '.icns', '.woff', '.woff2', '.ttf'}

def package(output=None):
    version = json_read(SOURCE / 'plugin.json')['version']
    output = Path(output) if output else SOURCE / 'dist' / f'antigrative-dashboard-{version}.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    for name in DIST_FILES:
        path = SOURCE / name
        if not path.exists():
            raise RuntimeError(f'Required release file missing: {name}')
        files = sorted(path.rglob('*')) if path.is_dir() else [path]
        for file in files:
            rel = file.relative_to(SOURCE)
            if not file.is_file() or any(p in IGNORED for p in rel.parts):
                continue
            if file.suffix in {'.log', '.pyc'}:
                continue
            entries.append((rel.as_posix(), file))
    entries.sort(key=lambda item: item[0])
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for rel_posix, file in entries:
            raw = file.read_bytes()
            if file.suffix.lower() not in BINARY_SUFFIXES:
                raw = raw.replace(b'\r\n', b'\n')
            info = zipfile.ZipInfo(f'antigrative-dashboard/{rel_posix}', date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            mode = 0o755 if file.suffix.lower() == '.sh' else 0o644
            info.external_attr = (0o100000 | mode) << 16
            bundle.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n', encoding='utf-8')
    print('Package:', output)
    print('SHA256:', digest)

def main():
    global APP
    parser = argparse.ArgumentParser(description='Antigrative Dashboard lifecycle manager')
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('install'); group = p.add_mutually_exclusive_group()
    group.add_argument('--panel-only', action='store_true')
    group.add_argument('--legacy-loader', action='store_true', help='Opt in to the old, version-specific app.asar adapter')
    p.add_argument('--app-path', type=Path, help='Path to the desktop app resources/app.asar for a custom installation')
    for action in ('enable', 'disable', 'uninstall'): sub.add_parser(action)
    p = sub.add_parser('status')
    p.add_argument('--app-path', type=Path, help='Path to the desktop app resources/app.asar for a custom installation')
    p = sub.add_parser('launch', help='Launch Antigravity Desktop with loopback debugging flags for the inline widget')
    p.add_argument('--exe', type=Path, help='Path to the Antigravity Desktop executable')
    p.add_argument('--workspace', type=Path, help='Optional workspace path to open')
    p.add_argument('--app-path', type=Path, help='Path to the desktop app resources/app.asar for a custom installation')
    p.add_argument('--restart', action='store_true', help='Gracefully quit a running macOS instance without remote debugging before relaunching')
    p = sub.add_parser('install-cli', help='Install the official CLI statusLine adapter independently of desktop')
    p.add_argument('--node', help='Node.js 20+ executable (defaults to PATH)')
    p.add_argument('--language', choices=('en', 'zh-CN', 'zh-TW'), help='Override shared desktop language choice')
    for action in ('uninstall-cli', 'status-cli'): sub.add_parser(action)
    p = sub.add_parser('package'); p.add_argument('--output')
    args = parser.parse_args()
    explicit_app = bool(args.action in ('install', 'status', 'launch') and getattr(args, 'app_path', None))
    if explicit_app:
        APP = args.app_path.expanduser().resolve()
    try:
        if args.action in ('install-cli', 'uninstall-cli', 'status-cli'):
            spec = importlib.util.spec_from_file_location('pulse_cli_lifecycle', SOURCE / 'cli' / 'lifecycle.py')
            cli = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cli)
            if args.action == 'install-cli': cli.install(SOURCE, HOME, args.node, args.language)
            elif args.action == 'uninstall-cli': cli.uninstall(HOME)
            else: cli.status(HOME)
            return 0
        if args.action == 'install': install(args.panel_only, args.legacy_loader)
        elif args.action == 'enable': set_enabled(True)
        elif args.action == 'disable': set_enabled(False)
        elif args.action == 'uninstall': uninstall()
        elif args.action == 'launch': launch(args.workspace, args.exe, restart=args.restart, explicit_app=explicit_app)
        elif args.action == 'status': status(explicit_app=explicit_app)
        elif args.action == 'package': package(args.output)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Antigrative Dashboard: {error}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
