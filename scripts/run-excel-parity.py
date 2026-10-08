#!/usr/bin/env python3
"""Run one fresh Codex file subagent at a time, fixing disparities before advancing.

Screenshots stay in file subagents. This orchestrator only sees JSON and logs.
One sequential worker provides exclusive Excel and code-modification ownership.
"""
import argparse
import atexit
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('parity_db', ROOT / 'scripts/excel-parity-db.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)


def task(row, directory, base_url):
    return f'''Audit and repair exactly one Excel dataset workbook in this fresh subagent context.
Project root: {ROOT}
Workbook: {row['filename']}
Source SHA256: {row['source_sha256']}
Current SuiteLeaf revision: {row['suiteleaf_revision']}
Current capture protocol revision: {row['audit_revision']}
Excel version: {row['excel_version']}
Evidence directory: {directory}
SuiteLeaf URL: {base_url}
Read docs/excel-visual-parity.md for capture commands, result contract, and audit rules.
You exclusively own native Excel and SuiteLeaf source fixes while this task runs.
Use the actual SuiteLeaf browser importer and native Microsoft Excel, disposable copies,
macros disabled, external links disabled. Preserve unrelated existing code changes and
user-open workbooks. Include hidden/very-hidden sheets by exposing them in disposable
copies. Capture exactly one screenshot per sheet in each application, at 100% zoom,
from its initial A1 view. Keep the full visible grid viewport. Do not pan, scroll to
other cells, enlarge columns, or take supplemental screenshots. Clipped or unreadable
content is acceptable; compare only visible, unambiguous content. A pass is scoped to
the captured view and says nothing about offscreen cells. View every paired PNG in
YOUR context, no screenshots to the parent.
Retry each failed capture operation once. Record persistent failures explicitly and
continue capturing one screenshot from every remaining sheet, including after a
mismatch. Use known documented dataset passwords when available, record remaining
barriers. Prioritize visible values, formula results, sheet visibility, charts, and
images. Minor font, spacing, border, color, or placement differences are acceptable.
Do not mask a visible content problem by changing only the reference. Record
reference_altered_by_excel=true whenever Excel repairs the original; recovered
reference cannot establish original parity. On first visible content disparity, FIX
the application, test the change meaningfully, then recapture and visually review this
workbook at the new revision. Repeat until fixed. Do not advance to another dataset
file or mask visible missing or changed content by removing it or replacing the real
importer.
Write {directory}/result.json following the documented contract. Record exact FINAL
SuiteLeaf fingerprint by loading scripts/excel-parity-db.py and calling revision().
Also record audit_revision from its audit_revision() function; both source and
capture protocol must remain stable throughout the final evidence capture.
Set capture_settings.coverage_mode to exactly "one initial viewport per sheet; clipped
content accepted". Set coverage_complete=true only when each sheet has one screenshot
pair and its visible content has been reviewed.
Record unresolved implementation issues and incomplete coverage honestly. If a disparity
cannot be fixed without user input, mark it with errors and do not claim a pass.
For each observed mismatch review, include a category (values, layout, formatting,
charts, images, controls, or unsupported) and concrete evidence references.
Final response is concise metadata only: filename, status, mismatch/fix summary,
evidence counts, result path, tests. Do not create a PR, commit, or message other chats.
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ledger.DEFAULT)
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--limit', type=int, help='Explicit bounded run; default all pending files')
    parser.add_argument('--paths', type=Path, help='JSON list of project-relative pilot filenames')
    parser.add_argument('--agent-timeout', type=int, default=0, help='Seconds; 0 means no file-review timeout')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Prevent multiple audit parents from sharing Excel or mutating code concurrently.
    import fcntl
    lock = (output / 'runner.lock').open('w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('Another audit runner already owns Excel and application changes')
    lock.write(str(os.getpid()))
    lock.flush()
    (output / 'runner.pid').write_text(str(os.getpid()) + '\n')
    def clear_pid_files():
        for name in ('runner.pid', 'active-agent.pid'):
            (output / name).unlink(missing_ok=True)
    atexit.register(clear_pid_files)
    db = ledger.connect(output)
    active_child = None

    def stop(signum, frame):
        if active_child is not None and active_child.poll() is None:
            os.killpg(active_child.pid, signal.SIGTERM)
            try:
                active_child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(active_child.pid, signal.SIGKILL)
                active_child.wait()
        raise SystemExit(f'Audit interrupted by signal {signum}; current file will be requeued on resume.')

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    ledger.initialize(db, output)
    # The exclusive parent lock proves no previous runner is still working.
    db.execute("UPDATE workbooks SET status='pending',parity=NULL WHERE status IN ('capturing','reviewing')")
    db.commit()
    unresolved = db.execute("SELECT filename FROM workbooks WHERE parity=0 LIMIT 1").fetchone()
    if unresolved:
        raise SystemExit('Unresolved disparity must be repaired and requeued first: ' + unresolved['filename'])
    selected = set(json.loads(args.paths.read_text())) if args.paths else None
    completed = 0
    while args.limit is None or completed < args.limit:
        rows = db.execute("SELECT * FROM workbooks WHERE status='pending' ORDER BY filename").fetchall()
        row = next((dict(r) for r in rows if selected is None or r['filename'] in selected), None)
        if row is None:
            break
        directory = output / 'files' / str(row['id']) / time.strftime('%Y%m%dT%H%M%S')
        directory.mkdir(parents=True, exist_ok=True)
        db.execute("UPDATE workbooks SET status='capturing',attempts=attempts+1,started_at=?,finished_at=NULL WHERE id=?", (ledger.now(), row['id']))
        db.commit()
        (directory / 'task.txt').write_text(task(row, directory, args.base_url))
        command = ['codex', 'exec', '--ephemeral', '--json', '--color', 'never',
                   '-s', 'danger-full-access', '-C', str(ROOT), '-o', str(directory / 'agent-summary.txt'), '-']
        print(json.dumps(dict(event='file_started', filename=row['filename'], evidence=str(directory))), flush=True)
        with (directory / 'agent.jsonl').open('w') as log, (directory / 'task.txt').open() as prompt:
            child = subprocess.Popen(command, cwd=ROOT, stdin=prompt, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True,
                                     env=dict(os.environ, SUITELEAF_PARITY_URL=args.base_url))
            active_child = child
            (output / 'active-agent.pid').write_text(str(child.pid) + '\n')
            try:
                exitcode = child.wait(timeout=args.agent_timeout or None)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait()
                exitcode = -1
            active_child = None
            (output / 'active-agent.pid').unlink(missing_ok=True)
        result_path = directory / 'result.json'
        if not result_path.exists() or exitcode != 0:
            # A failed file attempt remains terminal and is reported, but it does
            # not prevent reviews of independent source files. If the agent
            # changed the app before failing, establish that revision first so
            # this incomplete row records the version that actually ran.
            failed_revision, failed_protocol = ledger.revision(), ledger.audit_revision()
            if failed_revision != row['suiteleaf_revision'] or failed_protocol != row['audit_revision']:
                ledger.initialize(db, output)
            db.execute("UPDATE workbooks SET status='incomplete',parity=NULL,blocked_reasons=?,finished_at=? WHERE filename=?",
                       (json.dumps([f'File subagent failed or omitted result.json; exit={exitcode}; log={directory}/agent.jsonl']), ledger.now(), row['filename']))
            db.commit()
            ledger.report(db, output)
            completed += 1
            print(json.dumps(dict(event='file_finished', filename=row['filename'], status='incomplete',
                                  parity=None, error=f'agent exit {exitcode}', evidence=str(directory))), flush=True)
            continue
        final_revision = ledger.revision()
        final_protocol = ledger.audit_revision()
        if final_revision != row['suiteleaf_revision'] or final_protocol != row['audit_revision']:
            final_result = json.loads(result_path.read_text())
            db.execute('''INSERT INTO fix_events
              (filename,old_revision,new_revision,fixes,validation,recorded_at)
              VALUES (?,?,?,?,?,?)''', (row['filename'], row['suiteleaf_revision'], final_revision,
              json.dumps(final_result.get('fixes', [])), json.dumps(final_result.get('validation', [])), ledger.now()))
            db.commit()
            # Any source edit invalidates earlier results; re-audit against the new application.
            # Initialize clears stale embedded evidence and preserves original corpus hashes.
            ledger.initialize(db, output)
            row = dict(db.execute('SELECT * FROM workbooks WHERE filename=?', (row['filename'],)).fetchone())
        try:
            outcome = ledger.ingest(db, result_path)
        except Exception as error:
            db.execute("UPDATE workbooks SET status='incomplete',parity=NULL,blocked_reasons=?,finished_at=? WHERE filename=?",
                       (json.dumps([f'Result rejected: {error}; result={result_path}']), ledger.now(), row['filename']))
            db.commit()
            ledger.report(db, output)
            raise
        completed += 1
        ledger.report(db, output)
        print(json.dumps(dict(event='file_finished', **outcome)), flush=True)
        if outcome['parity'] == 0:
            raise SystemExit('Audit stopped on an unresolved disparity. Repair and requeue this file before continuing.')
    print(json.dumps(ledger.verify(db)), flush=True)
    print(json.dumps(ledger.report(db, output)), flush=True)
    db.close()


if __name__ == '__main__':
    main()
