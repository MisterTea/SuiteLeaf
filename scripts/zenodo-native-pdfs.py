#!/usr/bin/env python3
"""Serial PowerPoint PDF generation over the NAS, in resumable batches of ten."""
import atexit, argparse, fcntl, hashlib, io, json, os, re, struct, subprocess, time, zipfile, zlib
from pathlib import Path

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for data in iter(lambda:f.read(1024*1024),b''):h.update(data)
 return h.hexdigest()
def pages(path):
 text=subprocess.check_output(['pdfinfo',str(path)],text=True,stderr=subprocess.STDOUT)
 m=re.search(r'^Pages:\s+(\d+)',text,re.M)
 if not m:raise ValueError('PDF has no readable pages')
 return int(m[1])
def repair_zip(path):
 """Rebuild a zip whose central directory was cut off, using complete local entries."""
 data=path.read_bytes();pos=0;entries=[]
 while pos+30<=len(data) and data[pos:pos+4]==b'PK\x03\x04':
  ver,flag,method,mtime,mdate,crc,comp,uncomp,namelen,extralen=struct.unpack_from('<HHHHHIIIHH',data,pos+4)
  name=data[pos+30:pos+30+namelen].decode('utf-8','replace')
  start=pos+30+namelen+extralen
  if flag&8:break
  end=start+comp
  if end>len(data):break
  blob=data[start:end]
  if method==0:raw=blob
  elif method==8:raw=zlib.decompress(blob,-15)
  else:break
  entries.append((name,raw));pos=end
 if not any(name=='ppt/presentation.xml' for name,_ in entries):raise zipfile.BadZipFile('File is not a zip file')
 buf=io.BytesIO()
 with zipfile.ZipFile(buf,'w') as out:
  for name,raw in entries:out.writestr(name,raw)
 return buf.getvalue()
def open_office_zip(path):
 try:return zipfile.ZipFile(path)
 except zipfile.BadZipFile:return zipfile.ZipFile(io.BytesIO(repair_zip(path)))
def expected_pages(path):
 """Slides PowerPoint includes when it saves a PDF. Hidden slides are omitted."""
 with open_office_zip(path) as z:
  xml=z.read('ppt/presentation.xml')
  rels=z.read('ppt/_rels/presentation.xml.rels')
  targets={}
  for tag in re.finditer(rb'<Relationship\b[^>]*>', rels):
   item=tag.group(0)
   rid=re.search(rb'\bId="([^"]+)"', item)
   target=re.search(rb'\bTarget="([^"]+)"', item)
   if rid and target:targets[rid.group(1)]=target.group(1).decode('utf-8')
  count=0
  for tag in re.finditer(rb'<p:sldId\b([^>]*)/?>', xml):
   attrs=tag.group(1)
   if b'show="0"' in attrs:continue
   rid=re.search(rb'\br:id="([^"]+)"', attrs)
   hidden=False
   if rid and rid.group(1) in targets:
    part='ppt/'+targets[rid.group(1)].lstrip('/')
    try:body=z.read(part)
    except KeyError:body=b''
    root=re.search(rb'<p:sld\b([^>]*)>', body)
    if root and b'show="0"' in root.group(1):hidden=True
   if not hidden:count+=1
  return count
def close_staged(path):
 subprocess.run(['osascript',str(Path(__file__).with_name('powerpoint-close-staged.applescript')),str(path)],capture_output=True,text=True,timeout=20)
def restart_powerpoint():
 subprocess.run(['pkill','-f','Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint'],check=False)
 for _ in range(20):
  if subprocess.run(['pgrep','-f','Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint'],capture_output=True).returncode!=0:break
  time.sleep(0.3)
 else:
  subprocess.run(['pkill','-9','-f','Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint'],check=False)
  time.sleep(0.5)
 subprocess.run(['open','-a','Microsoft PowerPoint'],check=False)
 for _ in range(30):
  try:
   ready=subprocess.run(['osascript','-e','tell application "Microsoft PowerPoint" to get version'],capture_output=True,text=True,timeout=8)
  except subprocess.TimeoutExpired:continue
  if ready.returncode==0 and ready.stdout.strip():break
  time.sleep(0.4)
 spy=Path.home()/'GauciNAS/Datasets/zenodo10k/files/pptx/apache2.0/2024/41fde69739d885f2e079e2218c9ad5b4-20240620 Spyderisk Overview.pptx'
 if spy.exists():subprocess.run(['open','-a','Microsoft PowerPoint',str(spy)],check=False)
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path.home()/'GauciNAS/Datasets/zenodo10k');p.add_argument('--first-batch',type=int,default=1);p.add_argument('--last-batch',type=int,default=1045);p.add_argument('--exported',type=Path);a=p.parse_args()
 r=a.root; entries=sorted([e for e in json.loads((r/'metadata/upstream-tree.json').read_text())['entries'] if e['type']=='file' and e['path'].lower().endswith('.pptx')],key=lambda e:e['path'])
 script=Path(__file__).with_name('powerpoint-export-pdf.applescript'); stage=r/'audit/native-input';stage.mkdir(parents=True,exist_ok=True)
 logdir=r/'audit/native-pdf';logdir.mkdir(exist_ok=True);lock=open(Path('/tmp')/'suiteleaf-powerpoint-pdf.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 runlog=logdir/'manifest.jsonl';completed=0;errors=0;consecutive=0
 timed={}
 if (logdir/'run.log').exists():
  for line in (logdir/'run.log').read_text(errors='replace').splitlines():
   if not line.startswith('{'):continue
   try:rec=json.loads(line)
   except json.JSONDecodeError:continue
   if '-1712' in rec.get('error',''):timed[rec.get('index')]=timed.get(rec.get('index'),0)+1
 skip_timeouts={i for i,c in timed.items() if c>=3}
 grant=subprocess.Popen(['osascript',str(script.with_name('powerpoint-grant-access.applescript'))])
 def stop_grant():
  grant.terminate()
  try:grant.wait(timeout=5)
  except Exception:grant.kill()
 atexit.register(stop_grant)
 for n,e in enumerate(entries,1):
  batch=(n-1)//10+1
  if not a.first_batch<=batch<=a.last_batch:continue
  original=r/'files'/e['path']; kind='export' if a.exported else 'source'
  if a.exported:
   matches=list(a.exported.glob(f'{n:05d}-*.pptx'))+list((a.exported/'exports').glob(f'{n:05d}-*.pptx'))
   if len(matches)!=1:raise ValueError(f'Expected one exported PPTX for {n}, found {len(matches)}')
   source=matches[0];out=a.exported/'native-pdf'/f'{n:05d}.pdf'
  else:source=original;out=r/'ground-truth-pdf'/f'{n:05d}.pdf'
  record={'index':n,'batch':batch,'kind':kind,'source':str(source),'pdf':str(out),'started':time.time()}
  staged=stage/f'{n:05d}-{kind}.pptx'
  try:
   if n in skip_timeouts:raise RuntimeError('skipped: AppleEvent timed out on two previous attempts')
   if source.name.startswith('~$') or source.name.startswith('._'):raise ValueError('not a presentation')
   before_stat=source.stat();digest=sha(source);record['source_sha256']=digest
   if not a.exported and e.get('lfs') and digest!=e['lfs']['oid']:raise ValueError('Original differs from upstream SHA256')
   expected=expected_pages(source)
   record['expected_slides']=expected
   if expected==0:raise ValueError('presentation has no slides')
   proof=out.with_suffix('.pdf.json')
   if out.exists() and proof.exists() and json.loads(proof.read_text()).get('source_sha256')==digest and pages(out)==expected:
    record.update(status='verified-existing',pdf_pages=expected)
   else:
    out.parent.mkdir(parents=True,exist_ok=True)
    try:
     zipfile.ZipFile(source).close()
     h=hashlib.sha256()
     with source.open('rb') as src,staged.open('wb') as dst:
      for data in iter(lambda:src.read(1024*1024),b''):h.update(data);dst.write(data)
     if h.hexdigest()!=digest:raise ValueError('Staged copy checksum mismatch')
    except zipfile.BadZipFile:
     staged.write_bytes(repair_zip(source));record['repaired_truncated_zip']=True
    # PowerPoint asks before replacing an existing PDF, and that prompt stalls the export.
    if out.exists():out.unlink()
    result=subprocess.run(['osascript',str(script),str(staged),str(out)],capture_output=True,text=True,timeout=1860)
    if result.returncode:raise RuntimeError(result.stderr.strip())
    record['powerpoint_version']=result.stdout.strip().split('\t')[0]
    for attempt in range(60):
     try:
      count=pages(out)
      if count==expected:break
     except (OSError,ValueError,subprocess.CalledProcessError):pass
     time.sleep(1)
    else:raise ValueError('Native PDF missing or page count does not match slide count')
    if source.stat().st_mtime_ns!=before_stat.st_mtime_ns or sha(source)!=digest:raise ValueError('Source changed during export')
    record.update(status='verified',pdf_pages=count,pdf_sha256=sha(out));proof.write_text(json.dumps(record,indent=2)+'\n')
   completed+=1
  except Exception as ex:
   errors+=1;record.update(status='error',error=f'{type(ex).__name__}: {ex}')
  finally:
   if record.get('status') in ('verified','verified-existing'):staged.unlink(missing_ok=True)
   elif record.get('status')=='error' and staged.exists():
    try:close_staged(staged)
    except Exception:pass
    staged.unlink(missing_ok=True)
  record['finished']=time.time()
  with runlog.open('a') as f:f.write(json.dumps(record)+'\n')
  state={'completed':completed,'errors':errors,'last_index':n,'last_batch':batch,'kind':kind,'finished':False,'record':record}
  (logdir/'progress.json').write_text(json.dumps(state,indent=2)+'\n');print(json.dumps(record),flush=True)
  message=record.get('error','')
  if record.get('status')=='error' and any(s in message for s in ('-1712','-9074')):
   try:restart_powerpoint()
   except Exception:pass
  wedged=record.get('status')=='error' and any(s in message for s in ('-9074','-1712','TimeoutExpired','Staged copy checksum mismatch','PDF save did not produce output','Opened presentation not found'))
  consecutive=consecutive+1 if wedged else 0
  if consecutive>=5:raise RuntimeError('Stopped after repeated PowerPoint failures; inspect manifest and PowerPoint before resuming')
 state['finished']=True;(logdir/'progress.json').write_text(json.dumps(state,indent=2)+'\n')
if __name__=='__main__':main()
