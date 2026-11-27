"""Publish a checked package, including a previously withdrawn draft release."""
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request
import zipfile


LARGE_CONVERSATION_MODULES = tuple('sidecars/panel/' + name + '.mjs' for name in (
    'collection-state', 'background-statistics', 'background-worker',
    'disk-statistics', 'usage-disk-worker', 'usage-index',
))
IDE_RUNTIME_MODULES = tuple('ide/' + name for name in (
    'main.mjs', 'runtime.mjs', 'webview-targets.mjs', 'client.mjs',
    'remote-client.mjs', 'launch-self-heal.mjs', 'discovery.mjs', 'surface.cjs',
))
REQUIRED_HOOK_FILES = (
    'hooks.json', 'hooks/on-stop.ps1', 'hooks/toast.ps1',
    'hooks/default-settings.json', 'sounds/done.mp3', 'sounds/error.mp3',
)


def checked_assets(root, tag):
    version = json.loads((root / 'plugin.json').read_text(encoding='utf-8'))['version']
    if tag != f'v{version}':
        raise ValueError('Tag and plugin version differ')
    bundle = root / 'dist' / f'antigrative-dashboard-{version}.zip'
    checksum = bundle.with_suffix('.zip.sha256')
    if checksum.read_text(encoding='utf-8').split() != [hashlib.sha256(bundle.read_bytes()).hexdigest(), bundle.name]:
        raise ValueError('Package checksum mismatch')
    with zipfile.ZipFile(bundle) as archive:
        prefix = 'antigrative-dashboard/'
        for name in ('plugin.json', 'package.json', 'sidecars/panel/package.json', 'ide/package.json'):
            manifest = json.loads(archive.read(prefix + name))
            if manifest['version'] != version:
                raise ValueError(f'Packaged version differs in {name}')
        for required in ['ide/package.json', 'ide/manage.py', 'ide/package.py', 'ide/README.md']:
            archive.getinfo(prefix + required)
        for required in IDE_RUNTIME_MODULES:
            archive.getinfo(prefix + required)
        for required in ['compat/pricing.cjs', 'compat/usage-ui.cjs', 'sidecars/panel/socks5.mjs', 'sidecars/panel/ssh-remote.mjs', 'sidecars/panel/rate-quality.mjs', 'sidecars/panel/quota-estimator.mjs', 'sidecars/panel/usage.mjs', 'sidecars/panel/pricing.mjs']:
            archive.getinfo(prefix + required)
        for required in LARGE_CONVERSATION_MODULES:
            archive.getinfo(prefix + required)
        archive.getinfo(prefix + 'sidecars/panel/panel-source.mjs')
        archive.getinfo(prefix + 'sidecars/panel/trajectory-json.mjs')
        archive.getinfo(prefix + 'sidecars/panel/trajectory-reader.mjs')
        archive.getinfo(prefix + 'sidecars/panel/transcript.mjs')
        for required in ['delegation.mjs', 'task-usage.mjs', 'delegated-usage.mjs']:
            archive.getinfo(prefix + 'sidecars/panel/' + required)
        for required in ['compat/update-ui.cjs', 'compat/update-worker.py', 'compat/update-lock.py',
                         'sidecars/panel/updater.mjs', 'sidecars/panel/local-conversations.mjs', 'docs/UPDATES.md']:
            archive.getinfo(prefix + required)
        for required in ['install.sh', 'uninstall.sh', 'install.ps1', 'compat/runtime-ui.mjs', 'compat/launch-config.mjs', 'compat/launch_config.py', 'compat/theme.cjs', 'compat/host-theme.mjs', 'compat/preferences.mjs', 'compat/sidecar-owner.mjs', 'sidecars/panel/context.mjs', 'cli/common.mjs', 'cli/hook.mjs', 'cli/ledger.mjs', 'cli/statusline.mjs', 'cli/metrics.mjs', 'cli/render.mjs', 'cli/report.mjs', 'cli/samples.mjs', 'cli/usage.mjs', 'cli/lifecycle.py', 'tools/preview-cli.mjs', 'docs/CLI.md', 'docs/assets/cli-conversation.png', 'docs/assets/cli-conversation-zh.png']:
            archive.getinfo(prefix + required)
        for required in REQUIRED_HOOK_FILES:
            archive.getinfo(prefix + required)
    ide_version = json.loads((root / 'ide/package.json').read_text(encoding='utf-8'))['version']
    if ide_version != version:
        raise ValueError('IDE and desktop versions differ')
    ide = root / 'dist' / f'antigrative-dashboard-ide-{version}.vsix'
    ide_checksum = ide.with_suffix('.vsix.sha256')
    if ide_checksum.read_text(encoding='utf-8').split() != [hashlib.sha256(ide.read_bytes()).hexdigest(), ide.name]:
        raise ValueError('IDE package checksum mismatch')
    with zipfile.ZipFile(ide) as archive:
        package = json.loads(archive.read('extension/package.json'))
        if package['version'] != version or package['name'] != 'antigrative-dashboard-ide':
            raise ValueError('Packaged IDE identity/version differs')
        for name in ['extension/ide/extension.cjs', 'extension/ide/host.cjs',
                     'extension/ide/manage.py', 'extension/compat/inline-widget.cjs',
                     'extension/README.md', 'extension/LICENSE']:
            archive.getinfo(name)
        for name in IDE_RUNTIME_MODULES:
            archive.getinfo('extension/' + name)
        for name in ['compat/host-theme.mjs', 'compat/launch-config.mjs', 'compat/pricing.cjs', 'compat/usage-ui.cjs', 'sidecars/panel/socks5.mjs', 'sidecars/panel/ssh-remote.mjs', 'sidecars/panel/rate-quality.mjs', 'sidecars/panel/quota-estimator.mjs', 'sidecars/panel/usage.mjs', 'sidecars/panel/pricing.mjs']:
            archive.getinfo('extension/' + name)
        for name in LARGE_CONVERSATION_MODULES:
            archive.getinfo('extension/' + name)
        archive.getinfo('extension/sidecars/panel/trajectory-json.mjs')
        archive.getinfo('extension/sidecars/panel/trajectory-reader.mjs')
        archive.getinfo('extension/sidecars/panel/transcript.mjs')
        for required in ['delegation.mjs', 'task-usage.mjs', 'delegated-usage.mjs']:
            archive.getinfo('extension/sidecars/panel/' + required)
        archive.getinfo('extension/sidecars/panel/local-conversations.mjs')
    return [bundle, checksum, ide, ide_checksum]


class GitHub:
    def __init__(self, repository, token):
        self.base = 'https://api.github.com/repos/' + repository + '/'
        self.headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                        'User-Agent': 'Antigrative-Dashboard-Release'}

    def request(self, method, path, data=None, content_type='application/json'):
        url = path if path.startswith('https://') else self.base + path
        if urllib.parse.urlparse(url).hostname not in {'api.github.com', 'uploads.github.com'}:
            raise ValueError('Untrusted release endpoint')
        body = json.dumps(data).encode() if isinstance(data, dict) else data
        req = urllib.request.Request(url, data=body, method=method,
                                     headers={**self.headers, 'Content-Type': content_type})
        with urllib.request.urlopen(req, timeout=60) as response:
            result = response.read()
            return json.loads(result) if result else None

    def find(self, tag):
        page = 1
        while True:
            releases = self.request('GET', f'releases?per_page=100&page={page}')
            found = next((release for release in releases if release['tag_name'] == tag), None)
            if found or len(releases) < 100:
                return found
            page += 1


def publish(client, tag, commit, notes, assets):
    release = client.find(tag)
    if release and not release['draft']:
        raise ValueError('Release is already public; withdraw it before replacing its package')
    details = {'tag_name': tag, 'target_commitish': commit, 'name': 'Antigravity Progress Bar ' + tag,
               'body': notes, 'draft': True, 'prerelease': False}
    release = client.request('PATCH', 'releases/' + str(release['id']), details) if release else client.request('POST', 'releases', details)
    # All replacements happen while the release is private. Failed uploads leave
    # a draft, never a publicly visible mix of an old ZIP and a new checksum.
    for asset in assets:
        existing = next((entry for entry in release['assets'] if entry['name'] == asset.name), None)
        if existing:
            client.request('DELETE', 'releases/assets/' + str(existing['id']))
        upload = release['upload_url'].split('{', 1)[0] + '?name=' + urllib.parse.quote(asset.name)
        client.request('POST', upload, asset.read_bytes(), 'application/octet-stream')
    uploaded = client.request('GET', 'releases/' + str(release['id']))
    if {asset.name for asset in assets} != {entry['name'] for entry in uploaded['assets']}:
        raise ValueError('Uploaded assets differ from the checked package')
    result = client.request('PATCH', 'releases/' + str(release['id']), {'draft': False, 'make_latest': 'true'})
    if result['draft'] or result['tag_name'] != tag:
        raise ValueError('Publication verification failed')
    return result['html_url']


if __name__ == '__main__':
    import subprocess
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'plugin.json').read_text(encoding='utf-8'))['version']
    tag = os.environ.get('GITHUB_REF_NAME') or f'v{version}'
    repo = os.environ.get('GITHUB_REPOSITORY') or 'yanhyhuan/Antigravity-Progress-Bar'
    sha = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    token = os.environ.get('GH_TOKEN') or subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()
    assets = checked_assets(root, tag)
    client = GitHub(repo, token)
    print(publish(client, tag, sha, (root / 'GITHUB_RELEASE.md').read_text(encoding='utf-8'), assets))
