"""Fetch the composer's own stream and licence evidence, bounded to 64 MiB."""
from pathlib import Path
import hashlib
import json
import shutil
import time
import requests

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path(r'C:\Abhinav\Projects\_scratch\audio')
URL = 'https://audio.chriszabriskie.com/cylinders/cylinders-07.m4a'

if __name__ == '__main__':
    assert shutil.disk_usage('C:\\').free > 11 * 1024**3, 'Preserve 10 GiB plus scratch headroom'
    SCRATCH.mkdir(parents=True, exist_ok=True)
    dest = SCRATCH / 'cylinder-seven.m4a'
    if not dest.exists():
        deadline = time.monotonic() + 150
        temporary = dest.with_suffix('.part')
        with requests.get(URL, stream=True, timeout=(15, 30)) as r:
            r.raise_for_status()
            count = 0
            with temporary.open('wb') as f:
                for chunk in r.iter_content(262144):
                    count += len(chunk)
                    if count > 64 * 1024**2:
                        raise RuntimeError('Source exceeds bounded download')
                    if time.monotonic() > deadline:
                        raise TimeoutError('Source download exceeded 150 seconds')
                    f.write(chunk)
        temporary.replace(dest)
    expected = json.loads((ROOT / 'tools' / 'audio' / 'source.json').read_text())
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    assert digest == expected['download_sha256'], 'Source changed; verify licence and recording again'
    print(json.dumps({'source': URL, 'bytes': dest.stat().st_size, 'sha256': digest}), flush=True)
    for name, url in [('album', 'https://chriszabriskie.com/cylinders/'), ('licence', 'https://chriszabriskie.com/use/'), ('player', 'https://chriszabriskie.com/assets/player.js')]:
        r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20)
        r.raise_for_status()
        (SCRATCH / (name + '.txt')).write_text(r.text, encoding='utf-8')
