#!/usr/bin/env python3
"""Read-only inventory of ALL /data entries, including hidden files and symlinks.

Create: python3 data-manifest.py create /path/to/data /outside/data/manifest.json
Verify: python3 data-manifest.py verify /restored/data /outside/data/manifest.json
No file contents or secrets are included in the manifest.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def inventory(root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Data root must be a directory')
    entries = []

    def visit(directory):
        for child in sorted(directory.iterdir()):
            before = child.lstat()
            entry = {'path': child.relative_to(root).as_posix()}
            if stat.S_ISLNK(before.st_mode):
                entry.update(type='symlink', target=os.readlink(child))
            elif stat.S_ISDIR(before.st_mode):
                entry.update(type='directory')
                visit(child)
            elif stat.S_ISREG(before.st_mode):
                digest = hashlib.sha256()
                with child.open('rb') as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
                entry.update(type='file', bytes=before.st_size, sha256=digest.hexdigest())
            else:
                raise ValueError('Unsupported special entry in data directory')
            after = child.lstat()
            signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            if signature(before) != signature(after):
                raise ValueError('Data changed during inventory; stop all writers and retry')
            entries.append(entry)

    visit(root)
    return {'version': 1, 'entries': sorted(entries, key=lambda e: e['path'])}


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ('create', 'verify'):
        raise ValueError('Usage: data-manifest.py create|verify DATA_ROOT MANIFEST_JSON')
    mode, root, filename = sys.argv[1:]
    root, filename = Path(root).resolve(strict=True), Path(filename).resolve()
    if filename == root or root in filename.parents:
        raise ValueError('Manifest must be outside the data directory')
    result = inventory(root)
    if mode == 'create':
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(result, stream, ensure_ascii=True, sort_keys=True, indent=2)
            stream.write('\n')
    else:
        expected = json.loads(filename.read_text())
        if expected != result:
            raise ValueError('Verification FAILED: missing, extra, changed files, directories or symlinks')
    files = [e for e in result['entries'] if e['type'] == 'file']
    print(f'{mode}: {len(files)} files, {sum(e["bytes"] for e in files)} bytes; {len(result["entries"])} total entries')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
