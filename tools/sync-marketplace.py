"""Update marketplace.json version, download URL, and SHA-256 from dist/ release bundle."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = 'yanhyhuan/Antigravity-Progress-Bar'

def main():
    plugin = json.loads((ROOT / 'plugin.json').read_text(encoding='utf-8'))
    version = plugin['version']
    bundle = ROOT / 'dist' / f'antigrative-dashboard-{version}.zip'
    if not bundle.is_file():
        raise FileNotFoundError(f'Run `python manage.py package` first; missing {bundle}')
    digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    mp_path = ROOT / 'marketplace.json'
    mp = json.loads(mp_path.read_text(encoding='utf-8'))
    entry = mp['plugins'][0]
    entry['version'] = version
    entry['displayName'] = plugin.get('displayName') or plugin.get('display_name') or 'Antigravity Progress Bar'
    entry['description'] = plugin['description']
    entry['source'] = {
        'type': 'archive',
        'url': f'https://github.com/{REPO}/releases/download/v{version}/{bundle.name}',
        'sha256': digest,
    }
    mp_path.write_text(json.dumps(mp, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Synced marketplace.json -> v{version} ({digest})')

if __name__ == '__main__':
    main()
