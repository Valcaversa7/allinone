"""Verify each phone APK is standalone, single-ABI, and below the size budget."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile

parser = argparse.ArgumentParser()
parser.add_argument('apk', type=Path)
parser.add_argument('--abi', required=True, choices=['arm64-v8a', 'armeabi-v7a'])
parser.add_argument('--max-mb', type=float, default=60)
args = parser.parse_args()
size = args.apk.stat().st_size
with ZipFile(args.apk) as apk:
    entries = apk.infolist()
    names = set(apk.namelist())
    assert 'assets/index.android.bundle' in names, 'Missing embedded JS: this APK needs Metro!'
    assert apk.getinfo('assets/index.android.bundle').file_size > 0, 'Empty JS bundle'
    abis = {name.split('/')[1] for name in names if name.startswith('lib/') and name.endswith('.so')}
    assert abis == {args.abi}, f'Unexpected native architectures: {abis}'
    assert size <= args.max_mb * 1_000_000, f'APK exceeds {args.max_mb} MB budget'
    report = {
        'file': args.apk.name,
        'bytes': size,
        'MB': round(size / 1_000_000, 2),
        'reduction_vs_original_percent': round((1 - size / 184_748_470) * 100, 1),
        'abi': args.abi,
        'embedded_js': True,
        'largest_compressed_entries': [
            {'path': item.filename, 'bytes': item.compress_size}
            for item in sorted(entries, key=lambda item: item.compress_size, reverse=True)[:10]
        ],
    }
print(json.dumps(report, indent=2))
