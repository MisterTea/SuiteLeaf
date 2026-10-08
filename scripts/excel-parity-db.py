#!/usr/bin/env python3
"""Single-writer, resumable visual audit ledger. No computed pixel verdicts."""
import argparse
import hashlib
import io
import json
import plistlib
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'datasets/validation/excel-visual-parity'
EXTENSIONS = {'.xlsx', '.xls', '.xlsm', '.xlsb', '.xltx'}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def revision():
    git = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    h = hashlib.sha256()
    files = []
    for folder in ['apps/web/src', 'packages/core/src']:
        files.extend(p for p in (ROOT / folder).rglob('*') if p.is_file())
    files.extend(ROOT / p for p in ['package-lock.json', 'apps/web/package.json'])
    for path in sorted(files):
        h.update(str(path.relative_to(ROOT)).encode())
        h.update(bytes.fromhex(digest(path)))
    return git + ':' + h.hexdigest()


def excel_version():
    p = Path('/Applications/Microsoft Excel.app/Contents/Info.plist')
    if not p.exists():
        return 'unavailable'
    data = plistlib.loads(p.read_bytes())
    return str(data.get('CFBundleShortVersionString', 'unknown')) + ':' + str(data.get('CFBundleVersion', 'unknown'))


def audit_revision():
    h = hashlib.sha256()
    names = ['capture-suiteleaf-parity.mjs', 'excel-parity-native.py',
             'excel-parity-capture.applescript', 'excel-parity-grid.applescript',
             'excel-parity-grant-access.applescript', 'excel-parity-recover.applescript',
             'excel-parity-window.swift', 'excel-parity-db.py']
    for name in names:
        path = ROOT / 'scripts' / name
        if path.exists():
            h.update(name.encode())
            h.update(path.read_bytes())
    return h.hexdigest()


def connect(output):
    output.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(output / 'parity.sqlite', timeout=60)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbooks (
      id INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL,
      excel_screenshots TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(excel_screenshots)),
      suiteleaf_screenshots TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(suiteleaf_screenshots)),
      parity INTEGER CHECK(parity IN (0,1) OR parity IS NULL),
      audit_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
        ('pending','capturing','reviewing','complete','mismatch','unsupported','incomplete','blocked')),
      excel_readable INTEGER, suiteleaf_revision TEXT NOT NULL, excel_version TEXT NOT NULL,
      capture_settings TEXT NOT NULL DEFAULT '{}', sheets TEXT NOT NULL DEFAULT '[]',
      reviews TEXT NOT NULL DEFAULT '[]', mismatches TEXT NOT NULL DEFAULT '[]',
      blocked_reasons TEXT NOT NULL DEFAULT '[]', agent_id TEXT,
      fixes TEXT NOT NULL DEFAULT '[]', validation TEXT NOT NULL DEFAULT '[]',
      attempts INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT,
      result_path TEXT
    );
    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY, workbook_id INTEGER NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
      application TEXT NOT NULL CHECK(application IN ('excel','suiteleaf')),
      sheet_name TEXT NOT NULL, sheet_index INTEGER NOT NULL,
      original_visibility TEXT NOT NULL, cell_range TEXT NOT NULL, tile_id TEXT NOT NULL,
      image_sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      png BLOB NOT NULL,
      UNIQUE(workbook_id, application, sheet_index, tile_id)
    );
    CREATE INDEX IF NOT EXISTS workbook_status ON workbooks(status);
    CREATE TABLE IF NOT EXISTS fix_events (
      id INTEGER PRIMARY KEY, filename TEXT NOT NULL, old_revision TEXT NOT NULL,
      new_revision TEXT NOT NULL, fixes TEXT NOT NULL, validation TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_history (
      id INTEGER PRIMARY KEY, filename TEXT NOT NULL, suiteleaf_revision TEXT NOT NULL,
      workbook_record TEXT NOT NULL, archived_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history_screenshots (
      id INTEGER PRIMARY KEY, history_id INTEGER NOT NULL REFERENCES audit_history(id),
      original_screenshot_id INTEGER NOT NULL,
      application TEXT NOT NULL, sheet_name TEXT NOT NULL, sheet_index INTEGER NOT NULL,
      original_visibility TEXT NOT NULL, cell_range TEXT NOT NULL, tile_id TEXT NOT NULL,
      image_sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, png BLOB NOT NULL
    );
    ''')
    columns = {r['name'] for r in db.execute('PRAGMA table_info(workbooks)')}
    for name in ['fixes', 'validation']:
        if name not in columns:
            db.execute(f"ALTER TABLE workbooks ADD COLUMN {name} TEXT NOT NULL DEFAULT '[]'")
    if 'audit_revision' not in columns:
        db.execute("ALTER TABLE workbooks ADD COLUMN audit_revision TEXT NOT NULL DEFAULT ''")
    history_columns = {r['name'] for r in db.execute('PRAGMA table_info(history_screenshots)')}
    if 'original_screenshot_id' not in history_columns:
        db.execute('ALTER TABLE history_screenshots ADD COLUMN original_screenshot_id INTEGER')
    db.commit()
    return db


def archive(db, row):
    if row['finished_at'] is None:
        return
    history = db.execute('''INSERT INTO audit_history
      (filename,suiteleaf_revision,workbook_record,archived_at) VALUES (?,?,?,?)''',
      (row['filename'], row['suiteleaf_revision'], json.dumps(dict(row)), now())).lastrowid
    db.execute('''INSERT INTO history_screenshots
      (history_id,original_screenshot_id,application,sheet_name,sheet_index,original_visibility,cell_range,tile_id,
       image_sha256,width,height,png)
      SELECT ?,id,application,sheet_name,sheet_index,original_visibility,cell_range,tile_id,
             image_sha256,width,height,png FROM screenshots WHERE workbook_id=?''',
      (history, row['id']))


def complete_pass_is_valid(db, row):
    """Refuse inherited pass flags that lack every reviewed, embedded tile."""
    if row['status'] != 'complete' or row['parity'] != 1 or row['excel_readable'] != 1:
        return False
    sheets, reviews = json.loads(row['sheets']), json.loads(row['reviews'])
    if not sheets or not reviews:
        return False
    if not all(sheet.get('excel_complete') is True and sheet.get('suiteleaf_complete') is True
               and isinstance(sheet.get('expected_tiles'), list) and sheet['expected_tiles']
               for sheet in sheets):
        return False
    expected = [(sheet['index'], tile) for sheet in sheets for tile in sheet['expected_tiles']]
    if len(set(expected)) != len(expected):
        return False
    reviewed = {(review.get('sheet_index'), review.get('tile_id')) for review in reviews
                if review.get('parity') is True}
    if reviewed != set(expected):
        return False
    if any(review.get('parity') is not True for review in reviews):
        return False
    for app in ('excel', 'suiteleaf'):
        manifest = json.loads(row[app + '_screenshots'])
        refs = [(item.get('sheet_index'), item.get('tile_id')) for item in manifest]
        if len(refs) != len(expected) or set(refs) != set(expected):
            return False
        for item in manifest:
            evidence = db.execute('SELECT 1 FROM screenshots WHERE id=? AND workbook_id=? AND application=?',
                                  (item.get('screenshot_id'), row['id'], app)).fetchone()
            if not evidence:
                return False
    return db.execute('SELECT count(*) FROM screenshots WHERE workbook_id=?', (row['id'],)).fetchone()[0] == len(expected) * 2


def initialize(db, output):
    rev, version, protocol = revision(), excel_version(), audit_revision()
    old = {row['filename']: row for row in db.execute('SELECT * FROM workbooks')}
    inventory = []
    for dataset in sorted((ROOT / 'datasets').iterdir()):
        files = dataset / 'files'
        if not files.is_dir():
            continue
        for path in sorted(files.rglob('*')):
            if path.is_file() and path.suffix.lower() in EXTENSIONS:
                filename = path.relative_to(ROOT).as_posix()
                record = dict(filename=filename, format=path.suffix[1:].lower(),
                              source_sha256=digest(path), source_bytes=path.stat().st_size)
                inventory.append(record)
    frozen = json.dumps(inventory, ensure_ascii=False, indent=2) + '\n'
    inventory_path = output / 'inventory.json'
    if inventory_path.exists() and inventory_path.read_text() != frozen:
        raise ValueError('Frozen inventory changed. Use a new output directory for a changed corpus.')
    for record in inventory:
        previous = old.get(record['filename'])
        valid_previous_pass = not previous or previous['parity'] != 1 or complete_pass_is_valid(db, previous)
        if previous and not valid_previous_pass:
            db.execute("UPDATE workbooks SET parity=NULL,status='incomplete',blocked_reasons=? WHERE id=?",
                       (json.dumps(['Stored pass was missing complete embedded screenshot and review evidence; re-audit required.']), previous['id']))
            db.commit()
            previous = db.execute('SELECT * FROM workbooks WHERE id=?', (previous['id'],)).fetchone()
        if previous and valid_previous_pass and (previous['source_sha256'], previous['suiteleaf_revision'], previous['excel_version'], previous['audit_revision']) == (record['source_sha256'], rev, version, protocol):
            continue
        if previous:
            archive(db, previous)
            db.execute('DELETE FROM screenshots WHERE workbook_id=?', (previous['id'],))
            db.execute('DELETE FROM workbooks WHERE id=?', (previous['id'],))
        db.execute('''INSERT INTO workbooks
          (filename,format,source_sha256,source_bytes,suiteleaf_revision,excel_version,audit_revision)
          VALUES (:filename,:format,:source_sha256,:source_bytes,:revision,:version,:protocol)''',
          dict(record, revision=rev, version=version, protocol=protocol))
    inventory_path.write_text(frozen)
    for key, value in dict(inventory_sha256=hashlib.sha256(frozen.encode()).hexdigest(),
                           suiteleaf_revision=rev, excel_version=version, audit_revision=protocol, root=str(ROOT)).items():
        db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', (key, value))
    db.commit()
    return dict(files=len(inventory), revision=rev, excel_version=version)


def ingest(db, result_path):
    from PIL import Image
    result_path = result_path.resolve()
    result = json.loads(result_path.read_text())
    row = db.execute('SELECT * FROM workbooks WHERE filename=?', (result['filename'],)).fetchone()
    if row is None:
        raise ValueError('Filename absent from frozen inventory')
    if digest(ROOT / row['filename']) != row['source_sha256'] or result.get('source_sha256') != row['source_sha256']:
        raise ValueError('Source hash changed or result source hash missing')
    if result.get('suiteleaf_revision') != row['suiteleaf_revision']:
        raise ValueError('Result SuiteLeaf revision missing or differs from inventory')
    if result.get('excel_version') != row['excel_version']:
        raise ValueError('Result Excel version missing or differs from inventory')
    if result.get('audit_revision', '') != row['audit_revision']:
        raise ValueError('Result capture protocol missing or differs from inventory')
    sheets, reviews = result.get('sheets', []), result.get('reviews', [])
    manifests = {'excel': [], 'suiteleaf': []}
    evidence = {}
    with db:
        archive(db, row)
        db.execute('DELETE FROM screenshots WHERE workbook_id=?', (row['id'],))
        for item in result.get('screenshots', []):
            application = item['application']
            if application not in manifests:
                raise ValueError('Invalid screenshot application')
            if not isinstance(item['tile_id'], str):
                raise ValueError('Screenshot tile IDs must be strings')
            path = Path(item['path'])
            if not path.is_absolute():
                path = result_path.parent / path
            content = path.read_bytes()
            if not content.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('Evidence must be PNG')
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                width, height = image.size
            cursor = db.execute('''INSERT INTO screenshots
              (workbook_id,application,sheet_name,sheet_index,original_visibility,cell_range,
               tile_id,image_sha256,width,height,png) VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
              (row['id'], application, item['sheet_name'], item['sheet_index'], item['visibility'],
               item['range'], item['tile_id'], hashlib.sha256(content).hexdigest(), width, height, content))
            entry = dict(screenshot_id=cursor.lastrowid, sheet_name=item['sheet_name'],
                         sheet_index=item['sheet_index'], visibility=item['visibility'],
                         range=item['range'], tile_id=item['tile_id'])
            entry['capture'] = {k: v for k, v in item.items() if k not in {
                'path', 'normalized_path', 'full_window_path', 'application', 'sheet_name',
                'sheet_index', 'visibility', 'range', 'tile_id', 'image_hash'}}
            manifests[application].append(entry)
            evidence[(application, item['sheet_index'], item['tile_id'])] = entry
        errors = result.get('errors', [])
        if result.get('reference_altered_by_excel') is True:
            errors = [*errors, 'Excel repaired the disposable reference; parity against the unmodified original is inconclusive.']
        for review in reviews:
            key = (review['sheet_index'], review['tile_id'])
            if review.get('parity') is None:
                # An inconclusive review may still document what one application
                # displayed when the reference application could not be captured.
                if ('suiteleaf', *key) not in evidence:
                    raise ValueError('Inconclusive review must reference an embedded SuiteLeaf screenshot')
            elif not all((app, *key) in evidence for app in ['excel', 'suiteleaf']):
                raise ValueError('Visual review must reference an embedded screenshot pair')
        mismatches = [r for r in reviews if r.get('parity') is False]
        readable = result.get('excel_readable')
        reliable_reference = readable is True and not result.get('reference_altered_by_excel')
        rejected = result.get('suiteleaf_rejected') is True
        parity = None
        status = 'blocked' if not reliable_reference else 'incomplete'
        if reliable_reference and rejected:
            parity, status = 0, 'unsupported'
            mismatches.append(dict(reason=result.get('suiteleaf_rejection', 'SuiteLeaf rejected Excel-readable file')))
        elif reliable_reference and mismatches:
            parity, status = 0, 'mismatch'
        elif reliable_reference and sheets and not errors:
            expected = {(s['index'], t) for s in sheets for t in s.get('expected_tiles', [])}
            reviewed = {(r['sheet_index'], r['tile_id']) for r in reviews if r.get('parity') is True}
            excel = {(s, t) for a, s, t in evidence if a == 'excel'}
            suiteleaf = {(s, t) for a, s, t in evidence if a == 'suiteleaf'}
            complete = all(s.get('excel_complete') is True and s.get('suiteleaf_complete') is True
                           and s.get('expected_tiles') for s in sheets)
            if (complete and all(r.get('parity') is True for r in reviews)
                    and expected == excel == suiteleaf == reviewed
                    and sum(len(s.get('expected_tiles', [])) for s in sheets) == len(expected)
                    and result.get('sheet_inventory_complete') is True
                    and result.get('coverage_complete') is True):
                parity, status = 1, 'complete'
        for items in manifests.values():
            items.sort(key=lambda x: (x['sheet_index'], x['tile_id']))
        db.execute('''UPDATE workbooks SET excel_screenshots=?,suiteleaf_screenshots=?,parity=?,
          status=?,excel_readable=?,capture_settings=?,sheets=?,reviews=?,mismatches=?,
          blocked_reasons=?,agent_id=?,finished_at=?,result_path=?,fixes=?,validation=? WHERE id=?''',
          (json.dumps(manifests['excel']), json.dumps(manifests['suiteleaf']), parity, status,
           readable, json.dumps(result.get('capture_settings', {})), json.dumps(sheets),
           json.dumps(reviews), json.dumps(mismatches), json.dumps(errors), result.get('agent_id'),
           now(), str(result_path.relative_to(ROOT)), json.dumps(result.get('fixes', [])),
           json.dumps(result.get('validation', [])), row['id']))
    return dict(filename=row['filename'], parity=parity, status=status,
                excel_images=len(manifests['excel']), suiteleaf_images=len(manifests['suiteleaf']))


def report(db, output):
    current_revision = revision()
    current_protocol = audit_revision()
    counts = [dict(r) for r in db.execute('''SELECT format,
      CASE WHEN (suiteleaf_revision<>? OR audit_revision<>?) AND status NOT IN ('pending','capturing','reviewing') THEN 'stale' ELSE status END AS status,
      CASE WHEN suiteleaf_revision<>? OR audit_revision<>? THEN NULL ELSE parity END AS parity, count(*) AS files
      FROM workbooks GROUP BY 1,2,3 ORDER BY 1,2''', (current_revision, current_protocol, current_revision, current_protocol))]
    stats = dict(total=db.execute('SELECT count(*) FROM workbooks').fetchone()[0],
                 screenshots=db.execute('SELECT count(*) FROM screenshots').fetchone()[0],
                 image_bytes=db.execute('SELECT coalesce(sum(length(png)),0) FROM screenshots').fetchone()[0],
                 by_format=counts, generated_at=now(), current_suiteleaf_revision=current_revision,
                 archived_reviews=db.execute('SELECT count(*) FROM audit_history').fetchone()[0],
                 current_audit_revision=current_protocol)
    totals = dict(passing=0, failing=0, inconclusive=0, pending=0, in_progress=0, stale=0)
    for row in counts:
        key = ('stale' if row['status'] == 'stale' else
               'pending' if row['status'] == 'pending' else
               'in_progress' if row['status'] in ('capturing', 'reviewing') else
               'passing' if row['parity'] == 1 else
               'failing' if row['parity'] == 0 else 'inconclusive')
        totals[key] += row['files']
    categories = {}
    for workbook in db.execute('SELECT reviews,status FROM workbooks WHERE parity=0 AND suiteleaf_revision=? AND audit_revision=?', (current_revision, current_protocol)):
        per_file = {review.get('category', 'uncategorized') for review in json.loads(workbook['reviews']) if review.get('parity') is False}
        if workbook['status'] == 'unsupported':
            per_file.add('unsupported')
        for category in per_file:
            categories[category] = categories.get(category, 0) + 1
    stats.update(totals=totals, mismatch_categories=categories)
    (output / 'summary.json').write_text(json.dumps(stats, indent=2) + '\n')
    lines = ['# Excel visual parity audit', '',
             'Coverage scope: one initial viewport per sheet; clipped and offscreen content is not reviewed.', '',
             f"Workbooks: {stats['total']:,}. Embedded screenshots: {stats['screenshots']:,}.", '',
             '| Format | Status | Parity | Files |', '|---|---|---|---:|']
    for r in counts:
        lines.append(f"| {r['format']} | {r['status']} | { {None: 'inconclusive/unreviewed', 0: 'fail', 1: 'pass'}[r['parity']] } | {r['files']} |")
    lines += ['', 'Current outcomes: ' + ', '.join(f'{key.replace("_", " ")}: {value:,}' for key, value in totals.items()) + '.',
              '', '## Common remaining mismatch categories', '']
    lines += [f'- {category}: {count:,} workbook(s).' for category, count in sorted(categories.items(), key=lambda item: (-item[1], item[0]))] or ['No failing reviews are currently recorded at the current application and capture revisions. Pending files remain unreviewed.']
    reasons = db.execute("SELECT filename,status,blocked_reasons,mismatches FROM workbooks WHERE status NOT IN ('pending','capturing','reviewing','complete') ORDER BY filename")
    lines += ['', '## Recorded findings', '']
    for r in reasons:
        lines.append(f"- `{r['filename']}` ({r['status']}): " + r['mismatches'] + ' ' + r['blocked_reasons'])
    lines += ['', 'A pending record is not a completed review. Passing requires complete sheet inventory, coverage and visual evidence review.']
    fixes = list(db.execute('SELECT filename,fixes,validation FROM fix_events ORDER BY id'))
    if fixes:
        lines += ['', '## Fixes applied during the audit', '']
        for fix in fixes:
            lines.append(f"- `{fix['filename']}`: {fix['fixes']}. Checks: {fix['validation']}.")
    (output / 'report.md').write_text('\n'.join(lines) + '\n')
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    return stats


def verify(db):
    from PIL import Image
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    for history in db.execute('SELECT * FROM audit_history'):
        record = json.loads(history['workbook_record'])
        for app in ['excel', 'suiteleaf']:
            for item in json.loads(record[app + '_screenshots']):
                assert db.execute('SELECT 1 FROM history_screenshots WHERE history_id=? AND original_screenshot_id=? AND application=?',
                                  (history['id'], item['screenshot_id'], app)).fetchone()
    for row in db.execute('SELECT * FROM screenshots UNION ALL SELECT id,history_id AS workbook_id,application,sheet_name,sheet_index,original_visibility,cell_range,tile_id,image_sha256,width,height,png FROM history_screenshots'):
        assert hashlib.sha256(row['png']).hexdigest() == row['image_sha256']
        with Image.open(io.BytesIO(row['png'])) as image:
            image.load()
            assert image.size == (row['width'], row['height'])
    for row in db.execute('SELECT * FROM workbooks'):
        ids = []
        for app in ['excel', 'suiteleaf']:
            for item in json.loads(row[app + '_screenshots']):
                evidence = db.execute('SELECT * FROM screenshots WHERE id=?', (item['screenshot_id'],)).fetchone()
                assert evidence and evidence['workbook_id'] == row['id'] and evidence['application'] == app
                assert evidence['sheet_index'] == item['sheet_index'] and evidence['tile_id'] == item['tile_id']
                ids.append(evidence['id'])
        assert len(ids) == db.execute('SELECT count(*) FROM screenshots WHERE workbook_id=?', (row['id'],)).fetchone()[0]
        if row['parity'] == 1:
            assert ids and complete_pass_is_valid(db, row)
    return dict(integrity='ok', filenames=db.execute('SELECT count(*) FROM workbooks').fetchone()[0])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, default=DEFAULT)
    p.add_argument('command', choices=['init', 'ingest', 'report', 'verify', 'pending', 'fingerprint'])
    p.add_argument('result', type=Path, nargs='?')
    args = p.parse_args()
    if args.command == 'fingerprint':
        print(json.dumps(dict(suiteleaf_revision=revision(), excel_version=excel_version(), audit_revision=audit_revision())))
        return
    db = connect(args.output)
    if args.command == 'init':
        result = initialize(db, args.output)
    elif args.command == 'ingest':
        result = ingest(db, args.result)
    elif args.command == 'report':
        result = report(db, args.output)
    elif args.command == 'verify':
        result = verify(db)
    else:
        result = [dict(r) for r in db.execute("SELECT filename,source_sha256,suiteleaf_revision,excel_version FROM workbooks WHERE status='pending' ORDER BY filename")]
    print(json.dumps(result, ensure_ascii=False))
    db.close()


if __name__ == '__main__':
    main()
