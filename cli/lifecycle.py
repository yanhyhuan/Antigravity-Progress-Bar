"""Independent, reversible CLI statusLine installation. No desktop mutation."""
import json
import base64
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
from contextlib import contextmanager

NAME = 'antigrative-dashboard-cli'
HOOK_NAME = 'antigrative-dashboard-usage'
LANGUAGES = ('en', 'zh-CN', 'zh-TW')
RUNTIME_FILES = ('cli/common.mjs', 'cli/hook.mjs', 'cli/ledger.mjs', 'cli/metrics.mjs', 'cli/render.mjs',
                 'cli/report.mjs', 'cli/samples.mjs', 'cli/statusline.mjs', 'cli/usage.mjs',
                 'compat/platform.mjs', 'compat/preferences.mjs')
# A .cmd path agy can pass to `cmd /c` unquoted: no spaces or CMD metacharacters.
SAFE_CMD_PATH = re.compile(r'^[A-Za-z]:\\[^\s"%!^&|<>()]*$')


def display_path(path):
    # Redirected Windows consoles may use cp1252 even for a Unicode home path.
    encoding = getattr(os.sys.stdout, 'encoding', None) or 'utf-8'
    return str(path).encode(encoding, errors='backslashreplace').decode(encoding)


def read(file):
    if not file.exists():
        return {}
    value = json.loads(file.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict):
        raise RuntimeError('CLI configuration must be a JSON object.')
    return value


def write(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=file.name + '.', suffix='.tmp', dir=file.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def paths(home):
    base = Path(home) / '.gemini' / 'antigravity-cli'
    return base, base / 'settings.json', base / 'antigrative-dashboard', base / '.antigrative-dashboard-install.json'


def hooks_path(home):
    # agy loads global hooks only from here (not from the CLI settings.json).
    return Path(home) / '.gemini' / 'config' / 'hooks.json'


def data_path(home):
    return Path(home) / '.gemini' / 'antigravity-cli' / 'antigrative-dashboard-data'


def regular(path):
    # Includes Windows junctions (is_symlink alone does not cover them).
    if path.is_symlink() or (path.exists() and path.resolve() != path.absolute()):
        raise RuntimeError('CLI installation paths must not contain symlinks or junctions.')


def verify_root(root):
    regular(root)
    if root.exists():
        if read(root / 'installation.json').get('name') != NAME:
            raise RuntimeError('CLI destination is not our installation; refusing to overwrite it.')
        for child in root.rglob('*'):
            regular(child)


@contextmanager
def locked(base):
    regular(base)
    base.mkdir(parents=True, exist_ok=True)
    lock = base / '.antigrative-dashboard.lock'
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise RuntimeError('Another CLI lifecycle operation is active. If a prior operation crashed, inspect and remove .antigrative-dashboard.lock before retrying.')
    try:
        os.close(fd)
        yield
    finally:
        lock.unlink()


def command(node, script, language=None, platform=None):
    platform = platform or os.sys.platform
    values = [str(node), str(script)]
    if platform == 'win32':
        if language and language not in LANGUAGES:
            raise RuntimeError('Language must be en, zh-CN or zh-TW.')
        if any(any(char in value for char in '\r\n\x00') for value in values):
            raise RuntimeError('Node/home path contains unsupported control characters.')
        # agy's Go cmd.exe runner escapes quotes in a multi-argument command.
        # A quote-free encoded invocation avoids both that transport and CMD's
        # percent/delayed expansion. Paths remain literal PowerShell strings.
        literal = lambda value: "'" + value.replace("'", "''") + "'"
        invocation = ' & ' + ' '.join(literal(value) for value in values)
        if language:
            invocation += ' --language ' + language
        script = ('[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); '
                  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);'
                  + invocation + '; exit $LASTEXITCODE')
        encoded = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
        return 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + encoded
    else:
        result = ' '.join(shlex.quote(value) for value in values)
    if language:
        if language not in LANGUAGES:
            raise RuntimeError('Language must be en, zh-CN or zh-TW.')
        result += ' --language ' + language
    return result


def windows_shim(node, root, script, language=None):
    """A tiny .cmd launcher avoids a PowerShell start on every refresh/model call.

    Returns (path, body) or None when the paths cannot be expressed safely, in
    which case the PowerShell encoded transport is used instead."""
    node = str(node)
    if not node.isascii() or any(char in node for char in '%"\r\n\x00'):
        return None
    target = (root if hasattr(root, 'joinpath') else Path(root)) / (Path(script).stem + '.cmd')
    if not SAFE_CMD_PATH.match(str(target)):
        return None
    if language and language not in LANGUAGES:
        raise RuntimeError('Language must be en, zh-CN or zh-TW.')
    # %~dp0 is the launcher's own directory (UTF-16 inside CMD); the file is ASCII.
    body = '@echo off\r\n"' + node + '" "%~dp0cli\\' + script + '"' + (' --language ' + language if language else '') + '\r\n'
    return target, body


def launcher(node, root, script, language=None, platform=None):
    platform = platform or os.sys.platform
    if platform == 'win32':
        shim = windows_shim(node, root, script, language)
        if shim:
            return str(shim[0]), shim
    return command(node, root / 'cli' / script, language, platform), None


def owns_hook(entry, state):
    if not isinstance(entry, dict) or set(entry) - {'PreInvocation', 'enabled'}:
        return False
    handlers = entry.get('PreInvocation')
    known = state.get('hookCommands', [])
    return (isinstance(handlers, list) and len(handlers) > 0 and
            all(isinstance(item, dict) and item.get('command') in known for item in handlers))


def node_path(node=None):
    found = shutil.which(str(node or 'node'))
    if not found:
        raise RuntimeError('Node.js 20+ is required on PATH, or pass --node /absolute/path/to/node.')
    result = subprocess.run([found, '--version'], capture_output=True, text=True, check=True)
    try:
        major = int(result.stdout.strip().lstrip('v').split('.')[0])
    except ValueError:
        raise RuntimeError('The specified executable did not report a Node.js version.')
    if major < 20:
        raise RuntimeError('Node.js 20+ is required.')
    return Path(found).resolve()


def owns(current, state):
    return (state.get('name') == NAME and state.get('schema') == 1 and isinstance(current, dict)
            and current.get('type') == 'command' and isinstance(current.get('command'), str)
            and current['command'] in state.get('commands', [state.get('command')]))


def install(source, home, node=None, language=None, hook=True):
    node = node_path(node)
    base, settings, root, backup = paths(home)
    hooks_file = hooks_path(home)
    installed_command, status_shim = launcher(node, root, 'statusline.mjs', language)
    hook_command, hook_shim = launcher(node, root, 'hook.mjs')
    with locked(base):
        regular(settings)
        regular(backup)
        regular(hooks_file)
        verify_root(root)
        before = settings.read_bytes() if settings.exists() else None
        hooks_before = hooks_file.read_bytes() if hooks_file.exists() else None
        config, state, hooks = read(settings), read(backup), read(hooks_file)
        if HOOK_NAME in hooks and not owns_hook(hooks[HOOK_NAME], state):
            raise RuntimeError(f'{hooks_file.name} already has a "{HOOK_NAME}" entry we did not create; refusing to overwrite it.')
        current = config.get('statusLine')
        if root.exists() and (state.get('name') != NAME or state.get('schema') != 1):
            raise RuntimeError('CLI recovery record is missing or invalid; refusing to overwrite the installation.')
        owned = owns(current, state)
        if not owned:
            state = {'name': NAME, 'schema': 1, 'previousPresent': 'statusLine' in config, 'previous': current}
        elif state.get('name') != NAME or state.get('schema') != 1:
            raise RuntimeError('CLI recovery record has an incompatible shape.')
        # Save recovery BEFORE changing the setting, retaining prior backup on upgrades.
        state['commands'] = list(dict.fromkeys(([current['command']] if owned else []) + [installed_command]))
        state['command'] = installed_command
        hook_owned = HOOK_NAME in hooks
        if hook or hook_owned:
            # Remember every command we registered so later upgrades and uninstall recognise them.
            state['hookCommands'] = list(dict.fromkeys(state.get('hookCommands', []) + ([hook_command] if hook else [])))
            if 'hookCreatedFile' not in state:
                state['hookCreatedFile'] = hooks_before is None
        write(backup, state)
        root.mkdir(parents=True, exist_ok=True)
        write(root / 'installation.json', {'name': NAME, 'schema': 1})
        for name in RUNTIME_FILES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(source) / name, target)
        for shim in (status_shim, hook_shim if hook else None):
            if shim:
                shim[0].write_bytes(shim[1].encode('ascii'))
        if (settings.read_bytes() if settings.exists() else None) != before:
            raise RuntimeError('CLI settings changed during installation; retry without overwriting concurrent edits.')
        if (hooks_file.read_bytes() if hooks_file.exists() else None) != hooks_before:
            raise RuntimeError('hooks.json changed during installation; retry without overwriting concurrent edits.')
        config['statusLine'] = {**(current if owned else {}), 'type': 'command', 'command': installed_command, 'enabled': True}
        write(settings, config)
        if hook:
            hooks[HOOK_NAME] = {'PreInvocation': [{'type': 'command', 'command': hook_command, 'timeout': 10}]}
            write(hooks_file, hooks)
        elif hook_owned:
            remove_hook(hooks_file, hooks, state)
    print('CLI status line installed:', display_path(root))
    if hook:
        print(display_path('Usage details: type #usage (or #u, #用量, ##) in agy; answered locally without a model call.'))
    print('Reopen agy to load it. Desktop installation and statistics are unchanged.')


def remove_hook(hooks_file, hooks, state):
    hooks.pop(HOOK_NAME, None)
    if not hooks and state.get('hookCreatedFile'):
        hooks_file.unlink(missing_ok=True)
    else:
        write(hooks_file, hooks)


def uninstall(home):
    base, settings, root, backup = paths(home)
    hooks_file = hooks_path(home)
    if not root.exists() and not backup.exists():
        print('CLI status line is not installed.')
        return
    with locked(base):
        regular(settings)
        regular(backup)
        regular(hooks_file)
        verify_root(root)
        before = settings.read_bytes() if settings.exists() else None
        state, config = read(backup), read(settings)
        if state.get('name') != NAME or state.get('schema') != 1:
            raise RuntimeError('Missing or invalid CLI recovery record; refusing to remove runtime.')
        hooks = read(hooks_file)
        if owns_hook(hooks.get(HOOK_NAME), state):
            # A replacement entry under our name, written by someone else, is preserved.
            remove_hook(hooks_file, hooks, state)
        current = config.get('statusLine')
        if owns(current, state):
            if state.get('previousPresent'):
                config['statusLine'] = state.get('previous')
            else:
                config.pop('statusLine', None)
            if (settings.read_bytes() if settings.exists() else None) != before:
                raise RuntimeError('CLI settings changed during uninstall; retry without overwriting concurrent edits.')
            write(settings, config)
        # Preserve a replacement configured by the user after installation.
        if root.exists():
            resolved = root.resolve()
            if resolved.parent != base.resolve() or resolved.name != 'antigrative-dashboard':
                raise RuntimeError('CLI removal target is outside its expected directory.')
            shutil.rmtree(resolved)
        backup.unlink(missing_ok=True)
    print('CLI adapter removed; prior statusLine restored if still owned. Reopen agy.')
    if data_path(home).exists():
        print('Local usage statistics kept:', display_path(data_path(home)))


def status(home):
    _, settings, root, backup = paths(home)
    state, config = read(backup), read(settings)
    current = config.get('statusLine')
    configured = owns(current, state)
    hooks_file = hooks_path(home)
    hook = owns_hook(read(hooks_file).get(HOOK_NAME), state)
    print(json.dumps({'installed': (root / 'cli' / 'statusline.mjs').is_file(), 'configured': configured,
                      'enabled': configured and current.get('enabled', True) is not False,
                      'usageHook': hook, 'hooks': str(hooks_file), 'statistics': str(data_path(home)),
                      'directory': str(root), 'settings': str(settings)}, indent=2))
