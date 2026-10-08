"""Bounded native checkpoint regression using synthetic PNGs and mocked UI boundaries."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

spec = importlib.util.spec_from_file_location('native', Path(__file__).resolve().parents[1] / 'scripts/excel-parity-native.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class Watcher:
    def __init__(self, *args, **kwargs):
        pass
    def terminate(self):
        pass
    def communicate(self, **kwargs):
        return '', ''


class NativeResumeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.source = self.base / 'fixture.xlsx'
        self.source.write_bytes(b'synthetic source; Excel is mocked')
        self.output = self.base / 'evidence'
        self.fail_columns = set()
        self.captured = []

    def tearDown(self):
        self.tmp.cleanup()

    def excel(self, operation, *args):
        if operation == 'version':
            return '16.113.3'
        if operation == 'security':
            return 'security normal'
        if operation == 'open':
            return {'workbook':args[2], 'sheet_count':1}
        if operation == 'info':
            return {'visibility':'sheet visible'}
        if operation == 'sheet':
            return {'name':'Fixture', 'visibility':'sheet visible', 'last_row':1, 'last_column':2, 'freeze_panes':False}
        if operation == 'tile':
            col = int(args[3])
            return {'row_start':1, 'row_end':2, 'column_start':col, 'column_end':col + 1, 'range':f'${native.column_name(col)}$1:${native.column_name(col)}$2'}
        if operation == 'metrics':
            return {'width_points':50, 'height_points':15}
        return None

    def command(self, args, timeout=45):
        if str(args[0]) == 'python3':
            return json.dumps({'audit_revision':'protocol-fixture', 'excel_version':'16.113.3:16.113.26092714'})
        if str(args[0]) == 'swift':
            return json.dumps({'id':1, 'name':'Fixture', 'bounds':{'X':0,'Y':0,'Width':800,'Height':600}})
        if 'excel-parity-grid.applescript' in str(args[1]):
            return json.dumps({'x':0,'y':0,'height':500})
        if str(args[0]) == '/usr/sbin/screencapture':
            path=Path(args[-1]);self.captured.append(path.name)
            if any(f'c{col}.png' in path.name for col in self.fail_columns):
                raise RuntimeError('Synthetic capture interruption')
            Image.new('RGB',(800,600),'white').save(path)
        return ''

    def capture(self):
        with patch.object(native,'excel',self.excel), patch.object(native,'command',self.command), patch.object(native.subprocess,'Popen',Watcher), patch.object(native.time,'sleep'):
            return native.capture(self.source,self.output)

    def test_interruption_resume_truncated_tail_and_corrupt_images(self):
        self.fail_columns={2}
        first=self.capture()
        self.assertFalse(first['complete'])
        self.assertEqual(len(first['screenshots']),1)
        journal=Path(first['checkpoint_journal'])
        with journal.open('a') as f:
            f.write('{"event":"tile"')
        self.fail_columns=set();self.captured=[]
        second=self.capture()
        self.assertTrue(second['complete'])
        self.assertEqual(second['reused_tile_count'],1)
        self.assertEqual(self.captured,['sheet-1-r1c2.png'])
        self.assertEqual(second['screenshots'][0]['range'],'A1:A1')
        self.assertEqual(second['screenshots'][0]['logical_workbook_name'],'fixture.xlsx')
        # Check each evidence class independently; missing normalized evidence,
        # corrupt raw evidence, and corrupt full-window evidence all invalidate.
        for field in native.NativeJournal.image_fields:
            shot=second['screenshots'][0]
            original=Path(shot[field]).read_bytes()
            Path(shot[field]).write_bytes(original[:-1]+b'!')
            self.assertFalse(native.NativeJournal.valid(shot))
            Path(shot[field]).write_bytes(original)
        Path(second['screenshots'][0]['normalized_path']).unlink()
        Path(second['screenshots'][1]['full_window_path']).write_bytes(b'corrupt')
        self.captured=[]
        third=self.capture()
        self.assertTrue(third['complete'])
        self.assertEqual(third['reused_tile_count'],0)
        self.assertEqual(len(self.captured),2)
        self.assertTrue(all(native.NativeJournal.valid(s) for s in third['screenshots']))

    def test_all_tiles_missing_manifest_is_explicitly_incomplete(self):
        self.fail_columns={1,2}
        result=self.capture()
        self.assertEqual(result['screenshots'],[])
        self.assertFalse(result['complete'])
        self.assertFalse(result['sheets'][0]['excel_complete'])
        self.assertTrue(result['errors'])
        stored=json.loads((self.output/'excel.json').read_text())
        self.assertFalse(stored['complete'])
        self.assertEqual(stored['screenshots'],[])

    def test_identity_gates_reject_prior_tiles(self):
        result=self.capture()
        path=Path(result['checkpoint_journal'])
        original=path.read_bytes()
        header=json.loads(original.splitlines()[0]);header.pop('event')
        for key in ['source_sha256','workbook_name','excel_version','audit_revision','capture_settings']:
            with self.subTest(key=key):
                path.write_bytes(original)
                changed=dict(header);changed[key]='different'
                journal=native.NativeJournal(path,changed)
                self.assertEqual(journal.tiles,{})


if __name__=='__main__':
    unittest.main()
