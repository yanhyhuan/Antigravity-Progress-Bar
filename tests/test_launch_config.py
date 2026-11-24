import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

spec_lc = importlib.util.spec_from_file_location('pulse_launch_config', ROOT / 'compat' / 'launch_config.py')
lc = importlib.util.module_from_spec(spec_lc)
spec_lc.loader.exec_module(lc)

spec_mgr = importlib.util.spec_from_file_location('pulse_manager', ROOT / 'manage.py')
manager = importlib.util.module_from_spec(spec_mgr)
spec_mgr.loader.exec_module(manager)


def build_asar(files_map):
    header = {'files': {}}
    payload = bytearray()

    def insert(tree, parts, data):
        if len(parts) == 1:
            offset = len(payload)
            payload.extend(data)
            tree[parts[0]] = {'size': len(data), 'offset': str(offset)}
            return
        node = tree.setdefault(parts[0], {'files': {}})
        insert(node['files'], parts[1:], data)

    for rel, content in files_map.items():
        insert(header['files'], rel.split('/'), content)

    raw = json.dumps(header, separators=(',', ':')).encode('utf-8')
    pad = (-len(raw)) % 4
    return struct.pack('<4I', 4, 8 + len(raw) + pad, 4 + len(raw) + pad, len(raw)) + raw + (b'\x00' * pad) + bytes(payload)


def build_lnk(target, args='', icon=''):
    flags = 0x02 | 0x80
    if args:
        flags |= 0x20
    if icon:
        flags |= 0x40
    hdr = bytearray(76)
    struct.pack_into('<I', hdr, 0, 0x4C)
    struct.pack_into('<I', hdr, 0x14, flags)

    ansi_target = target.encode('latin1', errors='replace') + b'\x00'
    uni_target = target.encode('utf-16le') + b'\x00\x00'
    info_hdr_len = 0x24
    lb_off = info_hdr_len
    ub_off = lb_off + len(ansi_target)
    info_len = ub_off + len(uni_target)
    link_info = struct.pack('<9I', info_len, info_hdr_len, 0x01, 0, lb_off, 0, 0, ub_off, 0) + ansi_target + uni_target

    strings = bytearray()
    for flag, val in ((0x20, args), (0x40, icon)):
        if flags & flag:
            strings.extend(struct.pack('<H', len(val)))
            strings.extend(val.encode('utf-16le'))
    return bytes(hdr) + link_info + bytes(strings)


class LaunchConfigTests(unittest.TestCase):
    def test_inspect_host_archive_distinguishes_232_233_and_non_asar(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asar_232 = root / '232.asar'
            asar_232.write_bytes(build_asar({
                'package.json': json.dumps({'version': '2.32.2'}).encode('utf-8'),
                'dist/main.js': b"app.commandLine.appendSwitch('remote-debugging-port', '0');",
            }))
            self.assertEqual(lc.inspect_host_archive(asar_232), {'version': '2.32.2', 'requiresDebugFlag': False})

            asar_233 = root / '233.asar'
            asar_233.write_bytes(build_asar({
                'package.json': json.dumps({'version': '2.33.0'}).encode('utf-8'),
                'dist/main.js': b"if (!app.commandLine.hasSwitch('remote-debugging-port')) { removeStaleActivePortFile(p); }",
            }))
            self.assertEqual(lc.inspect_host_archive(asar_233), {'version': '2.33.0', 'requiresDebugFlag': True})

            plain = root / 'plain.asar'
            plain.write_bytes(b'future-host-build-without-asar-header')
            self.assertEqual(lc.inspect_host_archive(plain), {'version': None, 'requiresDebugFlag': False})

    def test_lnk_parser_shortcut_matching_and_argument_merging(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            desk_lnk = root / 'Antigravity.lnk'
            desk_lnk.write_bytes(build_lnk(r'C:\Users\demo\AppData\Local\Programs\antigravity\Antigravity.exe', '--foo=bar'))
            info = lc.parse_lnk(desk_lnk)
            self.assertEqual(info['target'], r'C:\Users\demo\AppData\Local\Programs\antigravity\Antigravity.exe')
            self.assertEqual(info['args'], '--foo=bar')
            self.assertTrue(lc.is_antigravity_desktop_shortcut(desk_lnk, info))

            proxy_lnk = root / 'Antigravity.lnk'
            proxy_info = {'target': r'C:\Tools\AntigravityProxy.exe', 'args': '', 'icon': r'C:\Apps\Antigravity.exe'}
            self.assertTrue(lc.is_antigravity_desktop_shortcut(proxy_lnk, proxy_info))

            ide_proxy = root / 'Antigravity IDE - Dashboard Preview.lnk'
            ide_info = {'target': r'C:\Tools\AntigravityProxy.exe', 'args': '--ide', 'icon': r'D:\Antigravity IDE\Antigravity IDE.exe'}
            self.assertFalse(lc.is_antigravity_desktop_shortcut(ide_proxy, ide_info))
            self.assertFalse(lc.is_antigravity_desktop_shortcut(root / 'IDE.lnk', {'target': r'D:\Antigravity IDE\Antigravity IDE.exe', 'args': ''}))

            launcher_target = r'C:\Users\demo\.antigravity-proxy\AntigravityLauncher.exe'
            self.assertTrue(lc.is_antigravity_desktop_shortcut(
                root / 'Antigravity (代理).lnk',
                {'target': launcher_target, 'args': '', 'icon': r'C:\Apps\Antigravity.exe'},
            ))
            self.assertTrue(lc.is_antigravity_desktop_shortcut(
                root / 'Antigravity (Proxy).lnk',
                {'target': launcher_target, 'args': '', 'icon': r'C:\Apps\Antigravity.exe,0'},
            ))
            self.assertTrue(lc.is_antigravity_desktop_shortcut(
                root / 'Antigravity (Прокси).lnk',
                {'target': launcher_target, 'args': '', 'icon': ''},
            ))
            self.assertFalse(lc.is_antigravity_desktop_shortcut(
                root / 'Antigravity (代理).lnk',
                {'target': launcher_target, 'args': '', 'icon': r'D:\Antigravity IDE\Antigravity IDE.exe'},
            ))
            self.assertFalse(lc.is_antigravity_desktop_shortcut(
                root / 'Antigravity (Proxy).lnk',
                {'target': launcher_target, 'args': '--ide', 'icon': r'C:\Apps\Antigravity.exe'},
            ))
            self.assertFalse(lc.is_antigravity_desktop_shortcut(
                root / 'Unrelated.lnk',
                {'target': launcher_target, 'args': '', 'icon': ''},
            ))

            merged, added = lc.merge_debug_arguments('--profile default -- https://example.com')
            self.assertEqual(added, [lc.DEBUG_PORT_FLAG, lc.DEBUG_ADDRESS_FLAG])
            self.assertEqual(merged, '--profile default --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 -- https://example.com')
            merged2, added2 = lc.merge_debug_arguments(merged)
            self.assertEqual(added2, [])
            self.assertEqual(merged2, merged)
            self.assertEqual(lc.strip_debug_arguments(merged, added), '--profile default -- https://example.com')

    def test_windows_shortcut_configure_and_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            desktop = home / 'Desktop'
            programs = home / 'AppData' / 'Roaming' / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs'
            desktop.mkdir(parents=True)
            programs.mkdir(parents=True)

            hub_lnk = desktop / 'Antigravity.lnk'
            hub_lnk.write_bytes(build_lnk(r'C:\Users\demo\AppData\Local\Programs\antigravity\Antigravity.exe', '--custom'))
            ide_lnk = desktop / 'Antigravity IDE.lnk'
            ide_lnk.write_bytes(build_lnk(r'D:\Antigravity IDE\Antigravity IDE.exe', ''))
            start_lnk = programs / 'Antigravity.lnk'
            start_lnk.write_bytes(build_lnk(r'C:\Tools\AntigravityProxy.exe', ''))
            launcher_lnk = desktop / 'Antigravity (代理).lnk'
            launcher_lnk.write_bytes(build_lnk(r'C:\Tools\AntigravityLauncher.exe', '', r'C:\Apps\Antigravity.exe'))
            launcher_ide_lnk = desktop / 'Antigravity IDE (代理).lnk'
            launcher_ide_lnk.write_bytes(build_lnk(r'C:\Tools\AntigravityLauncher.exe', '', r'D:\Antigravity IDE\Antigravity IDE.exe'))

            def fake_writer(updates):
                for item in updates:
                    p = Path(item['path'])
                    parsed = lc.parse_lnk(p)
                    p.write_bytes(build_lnk(parsed['target'], item['args'], parsed.get('icon', '')))

            res, managed = lc.configure_desktop_launch(platform='win32', home=home, env={}, shortcut_writer=fake_writer)
            self.assertTrue(res['configured'])
            self.assertEqual(len(res['entrypoints']), 3)
            self.assertEqual(lc.parse_lnk(hub_lnk)['args'], '--custom --remote-debugging-port=0 --remote-debugging-address=127.0.0.1')
            self.assertEqual(lc.parse_lnk(start_lnk)['args'], '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1')
            self.assertEqual(lc.parse_lnk(launcher_lnk)['args'], '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1')
            self.assertEqual(lc.parse_lnk(ide_lnk).get('args', ''), '')
            self.assertEqual(lc.parse_lnk(launcher_ide_lnk).get('args', ''), '')
            self.assertTrue(lc.inspect_desktop_launch(platform='win32', home=home, env={})['configured'])

            reverted = lc.remove_desktop_launch(platform='win32', home=home, env={}, managed=managed, shortcut_writer=fake_writer)
            self.assertEqual(reverted, {})
            self.assertEqual(lc.parse_lnk(hub_lnk).get('args', ''), '--custom')
            self.assertEqual(lc.parse_lnk(start_lnk).get('args', ''), '')
            self.assertEqual(lc.parse_lnk(launcher_lnk).get('args', ''), '')

    @unittest.skipUnless(sys.platform == 'win32', 'Real WScript.Shell roundtrip runs on Windows only')
    def test_windows_real_wscript_shortcut_roundtrip(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            desktop = home / 'Desktop'
            desktop.mkdir(parents=True)
            lnk = desktop / 'Antigravity.lnk'
            target = str(home / 'Antigravity.exe')
            Path(target).write_bytes(b'')
            ps = (
                f"$ws = New-Object -ComObject WScript.Shell; "
                f"$s = $ws.CreateShortcut('{str(lnk)}'); "
                f"$s.TargetPath = '{target}'; "
                f"$s.Arguments = '--existing'; "
                f"$s.Save()"
            )
            subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', ps],
                           check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            res, managed = lc.configure_desktop_launch(platform='win32', home=home, env={})
            self.assertTrue(res['configured'])
            parsed = lc.parse_lnk(lnk)
            self.assertEqual(parsed['args'], '--existing --remote-debugging-port=0 --remote-debugging-address=127.0.0.1')
            lc.remove_desktop_launch(platform='win32', home=home, env={}, managed=managed)
            self.assertEqual(lc.parse_lnk(lnk)['args'], '--existing')

    def test_linux_desktop_configure_preserves_unmanaged_and_rolls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / 'home'
            local = home / '.local' / 'share'
            sys_apps = root / 'usr' / 'share' / 'applications'
            sys_apps.mkdir(parents=True)
            (sys_apps / 'antigravity.desktop').write_text(
                '[Desktop Entry]\nName=Antigravity\nExec=/opt/Antigravity/antigravity %U\nType=Application\n',
                encoding='utf-8',
            )
            res, managed = lc.configure_desktop_launch(platform='linux', home=home, local=local, env={}, system_desktop_dirs=[sys_apps])
            self.assertTrue(res['configured'])
            user_file = local / 'applications' / 'antigravity.desktop'
            content = user_file.read_text(encoding='utf-8')
            self.assertIn('Exec=/opt/Antigravity/antigravity --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 %U', content)
            self.assertIn(lc.DESKTOP_MANAGED_MARKER, content)
            self.assertTrue(lc.inspect_desktop_launch(platform='linux', home=home, local=local, env={})['configured'])

            reverted = lc.remove_desktop_launch(platform='linux', home=home, local=local, env={}, managed=managed)
            self.assertEqual(reverted, {})
            self.assertFalse(user_file.exists())

            # User-created unmanaged .desktop must never be overwritten or removed.
            user_file.parent.mkdir(parents=True, exist_ok=True)
            custom = '[Desktop Entry]\nName=Antigravity\nExec=/custom/antigravity %U\n'
            user_file.write_text(custom, encoding='utf-8')
            res2, managed2 = lc.configure_desktop_launch(platform='linux', home=home, local=local, env={}, system_desktop_dirs=[sys_apps])
            self.assertFalse(res2['configured'])
            self.assertEqual(user_file.read_text(encoding='utf-8'), custom)
            lc.remove_desktop_launch(platform='linux', home=home, local=local, env={}, managed=managed2)
            self.assertTrue(user_file.exists())

    def test_manage_launch_and_status_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            local = home / 'AppData' / 'Local'
            plugin = home / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse'
            config = home / '.gemini' / 'config' / 'config.json'
            settings = local / 'AntigravityPulse' / 'settings.json'
            app = local / 'Programs' / 'antigravity' / 'resources' / 'app.asar'
            app.parent.mkdir(parents=True)
            app.write_bytes(build_asar({
                'package.json': json.dumps({'version': '2.33.0'}).encode('utf-8'),
                'dist/main.js': b"if (!app.commandLine.hasSwitch('remote-debugging-port')) { removeStaleActivePortFile(p); }",
            }))
            exe_name = 'Antigravity.exe' if sys.platform == 'win32' else ('MacOS/Antigravity' if sys.platform == 'darwin' else 'antigravity')
            exe_path = app.parent.parent / exe_name
            exe_path.parent.mkdir(parents=True, exist_ok=True)
            exe_path.write_bytes(b'')
            ws = home / 'workspace'
            ws.mkdir()

            spawned = []
            def fake_spawn(args, **kwargs):
                spawned.append((args, kwargs))
                return object()

            with patch.multiple(manager, HOME=home, LOCAL=local, PLUGIN=plugin, CONFIG=config, SETTINGS=settings, APP=app, BACKUPS=local / 'Backups'):
                buf = io.StringIO()
                with patch('sys.stdout', buf):
                    manager.status()
                st = json.loads(buf.getvalue())
                self.assertEqual(st['hostVersion'], '2.33.0')
                self.assertTrue(st['hostRequiresDebugFlag'])
                self.assertIn('launchConfiguration', st)

                with patch.dict(os.environ, {'ELECTRON_RUN_AS_NODE': '1'}):
                    manager.launch(workspace=ws, spawn=fake_spawn)
                self.assertEqual(len(spawned), 1)
                args, kwargs = spawned[0]
                self.assertEqual(args[0], str(exe_path))
                self.assertIn('--remote-debugging-port=0', args)
                self.assertIn('--remote-debugging-address=127.0.0.1', args)
                self.assertEqual(args[-1], str(ws.resolve()))
                self.assertNotIn('ELECTRON_RUN_AS_NODE', kwargs['env'])

    def test_macos_launcher_app_configure_preserves_unmanaged_and_rolls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / 'home'
            sys_apps = root / 'Applications'
            target_app = sys_apps / 'Antigravity.app'
            (target_app / 'Contents' / 'MacOS').mkdir(parents=True)
            (target_app / 'Contents' / 'Resources').mkdir(parents=True)
            (target_app / 'Contents' / 'MacOS' / 'Antigravity').write_bytes(b'bin')
            (target_app / 'Contents' / 'Resources' / 'app.asar').write_bytes(b'asar')
            (target_app / 'Contents' / 'Resources' / 'electron.icns').write_bytes(b'ICNS')

            res, managed = lc.configure_desktop_launch(
                platform='darwin', home=home, env={},
                app_asar=target_app / 'Contents' / 'Resources' / 'app.asar',
                profile=home / 'Library' / 'Application Support' / 'Antigravity',
                system_app_dirs=[sys_apps],
            )
            self.assertTrue(res['configured'])
            self.assertTrue(res['supported'])
            bundle = home / 'Applications' / lc.MACOS_LAUNCHER_NAME
            self.assertEqual(res['entrypoints'], [str(bundle)])
            self.assertEqual(managed['macosLauncherApp'], str(bundle))
            plist = (bundle / 'Contents' / 'Info.plist').read_text(encoding='utf-8')
            launcher = (bundle / 'Contents' / 'MacOS' / 'launcher').read_text(encoding='utf-8')
            self.assertIn(lc.MACOS_MANAGED_PLIST_KEY, plist)
            self.assertIn('<key>LSUIElement</key>', plist)
            self.assertIn('<string>app.icns</string>', plist)
            self.assertEqual((bundle / 'Contents' / 'Resources' / 'app.icns').read_bytes(), b'ICNS')
            self.assertIn(lc.DESKTOP_MANAGED_MARKER, launcher)
            self.assertIn('--remote-debugging-port=0 --remote-debugging-address=127.0.0.1', launcher)
            self.assertIn('/usr/bin/open -a', launcher)
            self.assertTrue(lc.inspect_desktop_launch(platform='darwin', home=home, env={})['configured'])

            reverted = lc.remove_desktop_launch(platform='darwin', home=home, env={}, managed=managed)
            self.assertEqual(reverted, {})
            self.assertFalse(bundle.exists())

            # Unmanaged user-created bundle with the same name must never be overwritten or removed.
            (bundle / 'Contents' / 'MacOS').mkdir(parents=True)
            (bundle / 'Contents' / 'Info.plist').write_text('<plist><dict/></plist>', encoding='utf-8')
            custom_script = '#!/bin/sh\necho custom\n'
            (bundle / 'Contents' / 'MacOS' / 'launcher').write_text(custom_script, encoding='utf-8')
            res2, managed2 = lc.configure_desktop_launch(
                platform='darwin', home=home, env={}, system_app_dirs=[sys_apps]
            )
            self.assertFalse(res2['configured'])
            self.assertEqual((bundle / 'Contents' / 'MacOS' / 'launcher').read_text(encoding='utf-8'), custom_script)
            lc.remove_desktop_launch(platform='darwin', home=home, env={}, managed=managed2)
            self.assertTrue(bundle.exists())

    def test_macos_launch_detects_running_instance_supports_restart_and_saved_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / 'home'
            local = home / 'Library' / 'Application Support'
            profile = local / 'Antigravity'
            profile.mkdir(parents=True)
            settings = local / 'AntigravityPulse' / 'settings.json'
            custom_app = root / 'Custom' / 'Antigravity.app'
            asar = custom_app / 'Contents' / 'Resources' / 'app.asar'
            exe = custom_app / 'Contents' / 'MacOS' / 'Antigravity'
            asar.parent.mkdir(parents=True)
            exe.parent.mkdir(parents=True)
            asar.write_bytes(build_asar({
                'package.json': json.dumps({'version': '2.33.0'}).encode('utf-8'),
                'dist/main.js': b"if (!app.commandLine.hasSwitch('remote-debugging-port')) { removeStaleActivePortFile(p); }",
            }))
            exe.write_bytes(b'macho')
            manager.atomic_json(settings, {'appResources': str(asar.parent), 'profile': str(profile)})

            class FakeProc:
                def __init__(self, stdout='', returncode=0):
                    self.stdout = stdout
                    self.returncode = returncode

            running = True
            quit_calls = []
            current_uid = os.getuid() if hasattr(os, 'getuid') else 501

            def fake_runner(cmd, **kwargs):
                nonlocal running
                if cmd[0] == '/bin/ps':
                    if running:
                        line = f"  4201 {current_uid} {exe.as_posix()}\n  4202 {current_uid} {exe.as_posix()} --type=renderer\n"
                        return FakeProc(line, 0)
                    return FakeProc('', 0)
                if cmd[0] == '/usr/bin/osascript':
                    quit_calls.append(cmd)
                    running = False
                    return FakeProc('', 0)
                return FakeProc('', 1)

            spawned = []
            def fake_spawn(args, **kwargs):
                spawned.append((args, kwargs))
                return object()

            missing_default_app = root / 'NonExistent' / 'app.asar'
            with patch.multiple(manager, HOME=home, LOCAL=local, SETTINGS=settings, APP=missing_default_app,
                                PLUGIN=home / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse',
                                CONFIG=home / '.gemini' / 'config' / 'config.json',
                                BACKUPS=local / 'Backups'):
                # Running without DevToolsActivePort must fail clearly instead of silently doing nothing.
                with self.assertRaisesRegex(RuntimeError, '--restart'):
                    manager.launch(platform='darwin', spawn=fake_spawn, runner=fake_runner, open_binary=True)
                self.assertEqual(spawned, [])

                # With --restart, gracefully quits via osascript then launches via /usr/bin/open -a.
                manager.launch(platform='darwin', restart=True, spawn=fake_spawn, runner=fake_runner, open_binary=True)
                self.assertEqual(len(quit_calls), 1)
                self.assertEqual(len(spawned), 1)
                self.assertEqual(spawned[0][0], [
                    '/usr/bin/open', '-a', str(custom_app), '--args',
                    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
                ])

                # When running AND DevToolsActivePort is already active, do not error or relaunch.
                running = True
                (profile / 'DevToolsActivePort').write_text('57824\n/devtools/browser/abc\n', encoding='utf-8')
                res = manager.launch(platform='darwin', spawn=fake_spawn, runner=fake_runner, open_binary=True)
                self.assertIsNone(res)
                self.assertEqual(len(spawned), 1)

    def test_windows_redirected_desktop_and_onedrive_shortcuts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / 'C_Users_demo'
            redirected_desktop = root / 'D_Users_demo' / 'Desktop'
            onedrive_root = root / 'OneDrive'
            onedrive_desktop = onedrive_root / 'Desktop'
            programs = home / 'AppData' / 'Roaming' / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs'
            for directory in (home / 'Desktop', redirected_desktop, onedrive_desktop, programs):
                directory.mkdir(parents=True)

            redir_lnk = redirected_desktop / 'Antigravity.lnk'
            redir_lnk.write_bytes(build_lnk(r'C:\Users\demo\AppData\Local\Programs\antigravity\Antigravity.exe', ''))
            od_lnk = onedrive_desktop / 'Antigravity.lnk'
            od_lnk.write_bytes(build_lnk(r'C:\Users\demo\AppData\Local\Programs\antigravity\Antigravity.exe', ''))
            start_lnk = programs / 'Antigravity.lnk'
            start_lnk.write_bytes(build_lnk(r'C:\Users\demo\AppData\Local\Programs\antigravity\Antigravity.exe', ''))

            written = []
            def fake_writer(updates):
                written.extend(updates)
                for item in updates:
                    p = Path(item['path'])
                    parsed = lc.parse_lnk(p)
                    p.write_bytes(build_lnk(parsed['target'], item['args'], parsed.get('icon', '')))

            env = {'CUSTOM_DESKTOP_ROOT': str(redirected_desktop.parent), 'OneDrive': str(onedrive_root)}
            resolver = lambda name: '%CUSTOM_DESKTOP_ROOT%\\Desktop' if name == 'Desktop' else None

            res, managed = lc.configure_desktop_launch(
                platform='win32', home=home, env=env, shortcut_writer=fake_writer, known_folder_resolver=resolver,
            )
            self.assertTrue(res['configured'])
            self.assertEqual(set(res['entrypoints']), {str(redir_lnk), str(od_lnk), str(start_lnk)})
            self.assertEqual(len(written), 3)
            for lnk in (redir_lnk, od_lnk, start_lnk):
                self.assertEqual(
                    lc.parse_lnk(lnk)['args'],
                    '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1',
                )
            inspected = lc.inspect_desktop_launch(
                platform='win32', home=home, env=env, known_folder_resolver=resolver,
            )
            self.assertTrue(inspected['configured'])
            self.assertEqual(set(inspected['entrypoints']), {str(redir_lnk), str(od_lnk), str(start_lnk)})

            # Uninstall rollback restores redirected shortcuts cleanly from managed state.
            reverted = lc.remove_desktop_launch(
                platform='win32', home=home, env=env, managed=managed, shortcut_writer=fake_writer,
            )
            self.assertEqual(reverted, {})
            for lnk in (redir_lnk, od_lnk, start_lnk):
                self.assertEqual(lc.parse_lnk(lnk).get('args', ''), '')

            # Deduplicates identical redirected and default paths without double-writing.
            dedup_roots = lc._windows_shortcut_roots(
                home,
                {'OneDrive': str(home)},
                known_folder_resolver=lambda name: str(home / 'Desktop') + '\\' if name == 'Desktop' else None,
            )
            desktop_matches = [p for p in dedup_roots if str(p).rstrip('\\/').casefold() == str(home / 'Desktop').casefold()]
            self.assertEqual(len(desktop_matches), 1)


if __name__ == '__main__':
    unittest.main()
