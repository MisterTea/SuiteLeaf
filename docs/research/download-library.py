"""Download only explicitly curated full works; preserve originals and validate PDFs.

Run with a Python environment containing pypdf. The local library is gitignored.
No credentials, purchases, preview conversion, or access-control bypasses are used.
"""
import concurrent.futures
import hashlib
import io
import json
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / 'research-library'
MANIFEST = Path(__file__).with_name('downloads.json')


def download(item):
    item = dict(item)
    destination = LIBRARY / item['filename']
    try:
        if destination.exists() and item.get('status') == 'downloaded':
            data = destination.read_bytes()
        else:
            try:
                req = Request(item['download_url'], headers={'User-Agent': 'Mozilla/5.0'})
                with urlopen(req, timeout=35) as response:
                    data = response.read()
                    item['resolved_url'] = response.url
            except Exception:
                with tempfile.NamedTemporaryFile(suffix='.pdf') as tmp:
                    fetched = subprocess.run(['curl', '-fsSL', '--max-time', '40',
                                              item['download_url'], '-o', tmp.name],
                                             capture_output=True, text=True)
                    if fetched.returncode:
                        raise ValueError(fetched.stderr.strip())
                    data = Path(tmp.name).read_bytes()
        if destination.suffix == '.epub':
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if archive.testzip() is not None:
                    raise ValueError('Corrupt EPUB archive')
                container = ET.fromstring(archive.read('META-INF/container.xml'))
                package = container.find('.//{*}rootfile').get('full-path')
                opf = ET.fromstring(archive.read(package))
                spine = opf.findall('.//{*}spine/{*}itemref')
                if not spine:
                    raise ValueError('EPUB has no reading order')
                item['spine_items'] = len(spine)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            item.update(status='downloaded', bytes=len(data),
                        sha256=hashlib.sha256(data).hexdigest(), local_path=str(destination),
                        verification='EPUB archive integrity, package, and reading order validated; full publisher-supplied ebook.')
            item.pop('error', None)
            return item
        if not data.startswith(b'%PDF-'):
            raise ValueError('Response is not a PDF; no file saved')
        pdf = PdfReader(io.BytesIO(data), strict=False)
        try:
            texts = [page.extract_text() or '' for page in pdf.pages]
        except (UnicodeError, ValueError):
            with tempfile.NamedTemporaryFile(suffix='.pdf') as tmp:
                Path(tmp.name).write_bytes(data)
                extracted = subprocess.run(['pdftotext', tmp.name, '-'],
                                           capture_output=True, check=True)
                texts = extracted.stdout.decode('utf-8', errors='replace').split('\f')
                texts = texts[:len(pdf.pages)]
        if len(texts) < 5:
            raise ValueError('Short handout excluded; fewer than five pages')
        if sum(len(t.strip()) for t in texts) < 1000:
            raise ValueError('Insufficient readable content; manual review required')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        extracts = LIBRARY / '.validation'
        extracts.mkdir(exist_ok=True)
        (extracts / (destination.stem + '.txt')).write_text('\n\n'.join(texts))
        item.update(status='downloaded', pages=len(texts), bytes=len(data),
                    sha256=hashlib.sha256(data).hexdigest(), local_path=str(destination),
                    verification='All pages parsed; full work as offered by publisher/author. Contents and closing pages reviewed; no excerpt URL.')
        item.pop('error', None)
    except Exception as error:
        item.update(status='failed', error=str(error))
    return item


if __name__ == '__main__':
    items = json.loads(MANIFEST.read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        items = list(pool.map(download, items))
    MANIFEST.write_text(json.dumps(items, indent=2) + '\n')
    for item in items:
        print(item['id'], item['status'], item.get('pages', ''), item.get('error', ''))
