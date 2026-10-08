#!/usr/bin/env python3
"""Capture native Excel UI from disposable copies, with an exclusive app lock.

python3 scripts/excel-parity-native.py SOURCE.xlsx OUTPUT_DIRECTORY [--password ...]
The result is OUTPUT_DIRECTORY/excel.json; screenshots are actual native window
PNGs. This helper does not assert visual parity. A separate file subagent must
review the evidence against SuiteLeaf. Grant Access dialogs require native UI.
"""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTROL = ROOT / 'scripts/excel-parity-capture.applescript'
WINDOW = ROOT / 'scripts/excel-parity-window.swift'


def command(args, timeout=45):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f'Command failed: {args[0]}')
    return result.stdout.strip()


def excel(*args):
    return json.loads(command(['osascript', CONTROL, *args]))


def retry(fn):
    for attempt in range(2):
        try:
            return fn()
        except Exception:
            if attempt:
                raise


def column_name(column):
    name = ''
    while column:
        column, rem = divmod(column - 1, 26)
        name = chr(65 + rem) + name
    return name


class NativeJournal:
    """Append-only completed-tile ledger; no native/UI calls in recovery."""
    image_fields = ('path', 'full_window_path', 'normalized_path')

    def __init__(self, path, header):
        self.path, self.header, self.tiles = path, header, {}
        matched = False
        try:
            data = path.read_bytes()
            records = [json.loads(line) for line in data[:data.rfind(b'\n') + 1].splitlines()]
            if records and records[0] == dict(event='start', **header):
                matched = True
                # Remove only the uncommitted partial tail, then continue appending.
                with path.open('r+b') as stream:
                    stream.truncate(data.rfind(b'\n') + 1)
                for record in records[1:]:
                    if record.get('event') == 'tile' and self.valid(record['screenshot']):
                        self.tiles[self.key(record['screenshot'])] = record['screenshot']
        except (OSError, ValueError, KeyError):
            pass
        if not matched:
            if path.exists():
                path.rename(path.with_name(path.name + f'.stale-{time.time_ns()}'))
            self.append(dict(event='start', **header))

    @staticmethod
    def key(shot):
        return (shot['sheet_index'], shot['sheet_name'], shot['visibility'], shot['tile_id'], shot['range'])

    @classmethod
    def valid(cls, shot):
        try:
            for field in cls.image_fields:
                path = pathlib.Path(shot[field])
                if hashlib.sha256(path.read_bytes()).hexdigest() != shot[field + '_sha256']:
                    return False
                with Image.open(path) as image:
                    if image.format != 'PNG':
                        return False
                    image.load()
            return True
        except (OSError, KeyError, ValueError):
            return False

    def append(self, record):
        with self.path.open('a') as stream:
            stream.write(json.dumps(record) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    def commit(self, shot):
        for field in self.image_fields:
            shot[field + '_sha256'] = hashlib.sha256(pathlib.Path(shot[field]).read_bytes()).hexdigest()
        if not self.valid(shot):
            raise RuntimeError('Native checkpoint contains invalid PNG evidence')
        self.append(dict(event='tile', screenshot=shot))
        self.tiles[self.key(shot)] = shot


def capture(source, output, password='', readable=False):
    output.mkdir(parents=True, exist_ok=True)
    fingerprint = json.loads(command(['python3', ROOT / 'scripts/excel-parity-db.py', 'fingerprint']))
    audit_revision_start = fingerprint['audit_revision']
    result = dict(filename=source.relative_to(ROOT).as_posix() if source.is_relative_to(ROOT) else str(source),
                  source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  excel_version=excel('version'), excel_version_build=fingerprint['excel_version'], application='excel', screenshots=[], sheets=[], errors=[],
                  audit_revision_start=audit_revision_start, capture_protocol_version=3,
                  capture_protocol_hash=hashlib.sha256(b''.join((ROOT / 'scripts' / name).read_bytes() for name in
                      ['excel-parity-native.py', 'excel-parity-capture.applescript', 'excel-parity-recover.applescript',
                       'excel-parity-grant-access.applescript', 'excel-parity-window.swift', 'excel-parity-grid.applescript'])).hexdigest(),
                  capture_settings=dict(zoom=100, native_window_points=[1440, 900], supplemental_readability=readable,
                                        tile_overlap='one complete row and column',
                                        normalization='native points 72dpi to CSS96dpi; retina removed' , screenshot='native-window',
                                        macros='force-disabled', external_links='disabled',
                                        appearance='white sheet; application chrome excluded from review'))
    workbook = None
    original_security = excel('security')
    with tempfile.TemporaryDirectory(prefix='excel-parity-', dir=output) as scratch:
        copy = pathlib.Path(scratch) / ('audit-' + pathlib.Path(scratch).name.rsplit('-', 1)[-1] + '-' + source.name)
        shutil.copy2(source, copy)
        try:
            for open_attempt in range(2):
                grant = subprocess.Popen(['osascript', str(ROOT / 'scripts/excel-parity-grant-access.applescript'), copy.name],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                recovery = subprocess.Popen(['osascript', str(ROOT / 'scripts/excel-parity-recover.applescript'), copy.name],
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    opened = excel('open', str(copy), password, copy.name)
                    break
                except Exception:
                    # Cancel only this disposable file's verified sandbox dialog,
                    # and close only its uniquely named workbook before retrying.
                    command(['osascript', ROOT / 'scripts/excel-parity-grant-access.applescript', copy.name, 'cancel'])
                    if excel('exists', copy.name):
                        excel('close', copy.name)
                    excel('restore-security', original_security)
                    if open_attempt:
                        raise
                finally:
                    grant.terminate()
                    grant.communicate(timeout=5)
                    try:
                        # A repair-completion prompt can appear just after the
                        # workbook becomes addressable. Allow the watcher to
                        # preserve its log and dismiss that prompt first.
                        recovery_text, recovery_error = recovery.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        recovery.terminate()
                        recovery_text, recovery_error = recovery.communicate(timeout=5)
                    if recovery_text.startswith('Recovered disposable workbook:'):
                        result['reference_recovery'] = recovery_text.strip()
                        result['reference_altered_by_excel'] = True
            workbook = opened['workbook']
            window_name = pathlib.Path(workbook).stem
            window_info = json.loads(command(['swift', WINDOW, window_name]))
            window_id = str(window_info['id'])
            grid_info = json.loads(command(['osascript', ROOT / 'scripts/excel-parity-grid.applescript', window_info['name']]))
            result['excel_readable'] = True
            result['checkpoint_journal'] = str(output / 'native-capture.ndjson')
            result['reused_tile_count'] = 0
            # Gate on the original logical workbook name; the unique disposable
            # copy name changes on reopen and is retained in tile provenance.
            journal = NativeJournal(output / 'native-capture.ndjson', dict(
                source_sha256=result['source_sha256'], filename=result['filename'],
                workbook_name=source.name, excel_version=result['excel_version_build'],
                audit_revision=audit_revision_start, protocol=result['capture_protocol_hash'],
                capture_settings=result['capture_settings'],
                native_window_size={k:window_info['bounds'][k] for k in ['Width','Height']},
                reference_altered_by_excel=result.get('reference_altered_by_excel', False)))
            for index in range(1, opened['sheet_count'] + 1):
                sheet = dict(index=index - 1, excel_complete=False, expected_tiles=[])
                result['sheets'].append(sheet)
                try:
                    original_info = excel('info', workbook, str(index))
                    metadata = retry(lambda: excel('sheet', workbook, str(index)))
                    metadata.update(original_info)
                    sheet.update(metadata)
                    sheet['index'] = index - 1
                    sheet['visibility'] = metadata['visibility'].removeprefix('sheet ').replace(' ', '')
                    if readable:
                        sheet.update(excel('readability', workbook, str(index), str(metadata['last_column'])))
                    row = 1
                    while True:
                        col = 1
                        row_end = None
                        while True:
                            tile = retry(lambda: excel('tile', workbook, str(index), str(row), str(col)))
                            tile_id = f'r{row}c{col}'
                            path = output / f'sheet-{index}-{tile_id}.png'
                            r_end = min(tile['row_end'] - 1, metadata['last_row'])
                            c_end = min(tile['column_end'] - 1, metadata['last_column'])
                            requested_range = f'{column_name(tile["column_start"])}{tile["row_start"]}:{column_name(c_end)}{r_end}'
                            metrics = excel('metrics', workbook, str(index), requested_range)
                            while metrics['width_points'] > 675 or metrics['height_points'] > 375:
                                if metrics['width_points'] > 675:
                                    if c_end <= tile['column_start']:
                                        raise RuntimeError('One column exceeds paired capture width at 100% zoom')
                                    c_end -= 1
                                if metrics['height_points'] > 375:
                                    if r_end <= tile['row_start']:
                                        raise RuntimeError('One row exceeds paired capture height at 100% zoom')
                                    r_end -= 1
                                requested_range = f'{column_name(tile["column_start"])}{tile["row_start"]}:{column_name(c_end)}{r_end}'
                                metrics = excel('metrics', workbook, str(index), requested_range)
                            cached = journal.tiles.get((index - 1, sheet['name'], sheet['visibility'], tile_id, requested_range))
                            if cached and NativeJournal.valid(cached):
                                result['screenshots'].append(cached)
                                result['reused_tile_count'] += 1
                            else:
                                # Allow native workbook rendering to settle before snapshot.
                                time.sleep(0.15)
                                retry(lambda: command(['/usr/sbin/screencapture', '-x', '-o', '-l' + window_id, path]))
                                if path.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
                                    raise RuntimeError('Native capture did not produce a PNG')
                                full_image = Image.open(path)
                                dpr = full_image.width / window_info['bounds']['Width']
                                # Excel 16.113.3 at normal view/100% has a 22-point
                                # row-heading width and a 21-point column-heading height.
                                # Calibrated against native full-window grid boundary:
                                # WithChart row boundary y396/397, chart top y398/399,
                                # native chart top 1.499921 points; the former +22
                                # height cropped away the original anchor offset.
                                # Retain
                                # the unmodified native PNG alongside the tight content crop.
                                # Wider row headings/frozen panes require manual full-grid review.
                                full_path = path.with_name(path.stem + '-full.png')
                                path.rename(full_path)
                                left = grid_info['x'] - window_info['bounds']['X'] + 22
                                top = grid_info['y'] - window_info['bounds']['Y'] + 21
                                crop = [round(left*dpr), round(top*dpr),
                                        round((left+metrics['width_points'])*dpr),
                                        round((top+metrics['height_points'])*dpr)]
                                exact_crop = tile['row_end'] < 1000 and not metadata['freeze_panes']
                                if exact_crop:
                                    full_image.crop(crop).save(path)
                                else:
                                    # Keep all cell content, including frozen panes. This
                                    # viewport evidence must be reviewed with its range metadata.
                                    full_image.crop((round(left*dpr), round(top*dpr), full_image.width,
                                                     round((grid_info['y']-window_info['bounds']['Y']+grid_info['height']-27)*dpr))).save(path)
                                normalized = path.with_name(path.stem + '-96dpi.png')
                                cropped = Image.open(path)
                                cropped.resize((round(cropped.width/dpr*96/72),
                                                round(cropped.height/dpr*96/72)), Image.Resampling.LANCZOS).save(normalized)
                                result['screenshots'].append(dict(application='excel', sheet_index=index - 1,
                                    sheet_name=sheet['name'], visibility=sheet['visibility'], range=requested_range, viewport_range=tile['range'].replace('$', ''),
                                    device_scale_factor=dpr, full_window_path=str(full_path),
                                    normalized_path=str(normalized), exact_cell_crop=exact_crop,
                                    crop_uncertainty=None if exact_crop else 'Frozen panes or wide row headings; inspect full window evidence',
                                    crop_pixels=crop, native_dpi=72, comparison_dpi=96,
                                    heading_width_points=22, heading_height_points=21,
                                    crop_calibration='Excel 16.113.3 normal view at 100%; measured header/grid boundary and native chart point geometry',
                                    range_width_points=metrics['width_points'], range_height_points=metrics['height_points'],
                                    tile_id=tile_id, path=str(path), native_bounds=window_info['bounds'],
                                    scroll_row=row, scroll_column=col,
                                    row_start=tile['row_start'], row_end=tile['row_end'],
                                    column_start=tile['column_start'], column_end=tile['column_end'],
                                    disposable_workbook_name=workbook, logical_workbook_name=source.name))
                                journal.commit(result['screenshots'][-1])
                            sheet['expected_tiles'].append(tile_id)
                            row_end = r_end if row_end is None else min(row_end, r_end)
                            # Last visible cells may be partial: overlap them on next tile.
                            if c_end >= metadata['last_column']:
                                break
                            next_col = max(col + 1, c_end - 1)
                            if next_col <= col:
                                raise RuntimeError('Cannot advance at 100% zoom; oversized or inaccessible columns')
                            col = next_col
                        if row_end >= metadata['last_row']:
                            break
                        next_row = max(row + 1, row_end - 1)
                        if next_row <= row:
                            raise RuntimeError('Cannot advance at 100% zoom; oversized or inaccessible rows')
                        row = next_row
                    sheet['excel_complete'] = bool(sheet['expected_tiles'])
                    journal.append(dict(event='sheet_end', sheet=sheet))
                except Exception as error:
                    sheet['blocked_reason'] = str(error)
                    result['errors'].append(dict(sheet_index=index - 1, reason=str(error)))
        except Exception as error:
            result['errors'].append(dict(reason=str(error)))
            result.setdefault('excel_readable', None)
        finally:
            if workbook:
                try:
                    excel('close', workbook)
                except Exception as error:
                    result['errors'].append(dict(reason='Cleanup: ' + str(error)))
            try:
                excel('restore-security', original_security)
            except Exception as error:
                result['errors'].append(dict(reason='Settings cleanup: ' + str(error)))
            result['audit_revision'] = json.loads(command(['python3', ROOT / 'scripts/excel-parity-db.py', 'fingerprint']))['audit_revision']
            if result['audit_revision'] != audit_revision_start:
                result['errors'].append(dict(reason='Capture helper fingerprint changed during capture; recapture required'))
            result['complete'] = bool(result['sheets']) and not result['errors'] and all(s.get('excel_complete') and s.get('expected_tiles') for s in result['sheets'])
            (output / 'excel.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--password', default='')
    parser.add_argument('--readable', action='store_true', help='Supplemental capture with widened columns; retain original-width baseline separately')
    args = parser.parse_args()
    # Shared flock ensures concurrent file agents cannot interfere with Excel.
    lock = pathlib.Path(tempfile.gettempdir()) / 'suiteleaf-excel-visual-parity.lock'
    with lock.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        evidence = capture(args.source.resolve(), args.output.resolve(), args.password, args.readable)
    print(json.dumps(dict(manifest=str(args.output.resolve() / 'excel.json'),
                         sheets=len(evidence['sheets']), screenshots=len(evidence['screenshots']),
                         errors=evidence['errors'])))
