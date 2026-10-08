"""Audit integrity regressions: incomplete or unpaired evidence must never pass."""
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ledger', ROOT / 'scripts/excel-parity-db.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)


class LedgerTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'test-results').mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'test-results')
        self.output = Path(self.tmp.name)
        self.db = ledger.connect(self.output)
        self.source = self.output / 'source.xlsx'
        self.source.write_bytes(b'owned test source')
        self.filename = self.source.relative_to(ROOT).as_posix()
        self.sha = ledger.digest(self.source)
        self.db.execute('''INSERT INTO workbooks
          (filename,format,source_sha256,source_bytes,suiteleaf_revision,excel_version)
          VALUES (?,?,?,?,?,?)''', (self.filename, 'xlsx', self.sha, 17, 'rev', 'version'))
        self.db.commit()
        Image.new('RGB', (30, 30), 'white').save(self.output / 'owned.png')
        self.result = dict(filename=self.filename, source_sha256=self.sha,
          suiteleaf_revision='rev', excel_version='version', excel_readable=True,
          sheet_inventory_complete=True, coverage_complete=True,
          sheets=[dict(index=0, name='One', visibility='hidden', expected_tiles=['t1'],
                       excel_complete=True, suiteleaf_complete=True)],
          screenshots=[dict(application=a, sheet_index=0, sheet_name='One',
                            visibility='hidden', range='A1:B2', tile_id='t1', path='owned.png')
                       for a in ['excel', 'suiteleaf']],
          reviews=[dict(sheet_index=0, tile_id='t1', parity=True)], errors=[])

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def ingest(self):
        path = self.output / 'result.json'
        path.write_text(json.dumps(self.result))
        return ledger.ingest(self.db, path)

    def test_complete_pass_embeds_and_verifies(self):
        self.assertEqual(self.ingest()['parity'], 1)
        self.assertEqual(ledger.verify(self.db)['integrity'], 'ok')
        self.assertEqual(self.db.execute('SELECT count(*) FROM screenshots').fetchone()[0], 2)

    def test_missing_sheet_coverage_never_passes(self):
        self.result['sheets'].append(dict(index=1, name='Two', expected_tiles=['t2'],
                                          excel_complete=False, suiteleaf_complete=False))
        self.assertIsNone(self.ingest()['parity'])

    def test_missing_review_never_passes(self):
        self.result['reviews'] = []
        self.assertIsNone(self.ingest()['parity'])

    def test_unpaired_review_rolls_back(self):
        self.result['screenshots'].pop()
        with self.assertRaises(ValueError):
            self.ingest()
        self.assertEqual(self.db.execute('SELECT count(*) FROM screenshots').fetchone()[0], 0)

    def test_source_mutation_rejected(self):
        self.source.write_bytes(b'changed')
        with self.assertRaises(ValueError):
            self.ingest()

    def test_stale_revision_rejected(self):
        self.result['suiteleaf_revision'] = 'old'
        with self.assertRaises(ValueError):
            self.ingest()

    def test_stale_capture_protocol_rejected(self):
        self.db.execute("UPDATE workbooks SET audit_revision='new-crop-method'")
        self.db.commit()
        self.result['audit_revision'] = 'old-crop-method'
        with self.assertRaises(ValueError):
            self.ingest()
        self.assertEqual(self.db.execute('SELECT count(*) FROM screenshots').fetchone()[0], 0)

    def test_observed_mismatch_fails(self):
        self.result['reviews'][0].update(parity=False, reason='Visible value differs')
        self.assertEqual(self.ingest()['parity'], 0)

    def test_reference_blocker_inconclusive(self):
        self.result.update(excel_readable=None, screenshots=[], reviews=[],
                           errors=['Excel unavailable'])
        self.assertIsNone(self.ingest()['parity'])

    def test_excel_repaired_reference_cannot_establish_parity(self):
        self.result['reference_altered_by_excel'] = True
        self.assertIsNone(self.ingest()['parity'])
        self.result['reviews'][0]['parity'] = False
        self.assertIsNone(self.ingest()['parity'])
        self.assertEqual(ledger.verify(self.db)['integrity'], 'ok')

    def test_replaced_verdict_retains_self_contained_history(self):
        self.ingest()
        self.result['reviews'][0]['parity'] = False
        self.ingest()
        self.assertEqual(self.db.execute('SELECT count(*) FROM audit_history').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM history_screenshots').fetchone()[0], 2)
        self.assertEqual(ledger.verify(self.db)['integrity'], 'ok')

    def test_resume_preserves_completed_results_and_revision_change_requeues(self):
        root = self.output / 'project'
        files = root / 'datasets/sample/files'
        files.mkdir(parents=True)
        (files / 'one.xlsx').write_bytes(b'owned original')
        output = root / 'audit'
        db = ledger.connect(output)
        try:
            with patch.object(ledger, 'ROOT', root), patch.object(ledger, 'revision', return_value='r1'), patch.object(ledger, 'excel_version', return_value='v'):
                ledger.initialize(db, output)
                db.execute("UPDATE workbooks SET status='blocked',blocked_reasons='[\"password\"]'")
                db.commit()
                ledger.initialize(db, output)
                self.assertEqual(db.execute('SELECT status FROM workbooks').fetchone()[0], 'blocked')
            with patch.object(ledger, 'ROOT', root), patch.object(ledger, 'revision', return_value='r2'), patch.object(ledger, 'excel_version', return_value='v'):
                ledger.initialize(db, output)
                self.assertEqual(db.execute('SELECT status FROM workbooks').fetchone()[0], 'pending')
                (files / 'added.xlsx').write_bytes(b'new original')
                with self.assertRaises(ValueError):
                    ledger.initialize(db, output)
                self.assertEqual(db.execute('SELECT count(*) FROM workbooks').fetchone()[0], 1)
        finally:
            db.close()

    def test_capture_protocol_change_archives_and_requeues_completed_review(self):
        root = self.output / 'project'
        files = root / 'datasets/sample/files'
        files.mkdir(parents=True)
        (files / 'one.xlsx').write_bytes(b'owned original')
        db = ledger.connect(root / 'audit')
        try:
            with patch.object(ledger, 'ROOT', root), patch.object(ledger, 'revision', return_value='r'), patch.object(ledger, 'excel_version', return_value='v'), patch.object(ledger, 'audit_revision', return_value='crop-v1'):
                ledger.initialize(db, root / 'audit')
                db.execute("UPDATE workbooks SET status='blocked',blocked_reasons='[\"capture failed\"]',finished_at=?", (ledger.now(),))
                db.commit()
            with patch.object(ledger, 'ROOT', root), patch.object(ledger, 'revision', return_value='r'), patch.object(ledger, 'excel_version', return_value='v'), patch.object(ledger, 'audit_revision', return_value='crop-v2'):
                ledger.initialize(db, root / 'audit')
                self.assertEqual(db.execute('SELECT status FROM workbooks').fetchone()[0], 'pending')
                self.assertEqual(db.execute('SELECT audit_revision FROM workbooks').fetchone()[0], 'crop-v2')
                self.assertEqual(db.execute('SELECT count(*) FROM audit_history').fetchone()[0], 1)
        finally:
            db.close()


if __name__ == '__main__':
    unittest.main()
