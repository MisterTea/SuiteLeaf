#!/usr/bin/env python3
"""Compare native PowerPoint PDFs; raster equality is evidence, not editability proof."""
import argparse, hashlib, json, re, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

def run(*args):
 return subprocess.check_output([str(a) for a in args],text=True)
def info(path):
 text=run('pdfinfo',path)
 return {'pages':int(re.search(r'^Pages:\s+(\d+)',text,re.M)[1]),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
def compare(source, exported, destination):
 destination.mkdir(parents=True,exist_ok=True)
 original=info(source); result=info(exported)
 rows=[]
 with tempfile.TemporaryDirectory(prefix='suiteleaf-pdf-') as temp:
  for page in range(1,max(original['pages'],result['pages'])+1):
   row={'page':page,'status':'missing-page'}
   if page<=min(original['pages'],result['pages']):
    images=[];texts=[]
    for label,pdf in [('source',source),('export',exported)]:
     target=Path(temp)/label
     subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1000','-png',str(pdf),str(target)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
     images.append(Image.open(str(target)+'.png').convert('RGB'))
     texts.append(run('pdftotext','-f',page,'-l',page,pdf,'-'))
    a,b=images
    if a.size!=b.size:b=b.resize(a.size,Image.Resampling.LANCZOS)
    diff=ImageChops.difference(a,b)
    rms=sum(v*v for v in ImageStat.Stat(diff).rms)**0.5/(3**0.5*255)
    mask=diff.convert('L').point(lambda p:255 if p>20 else 0)
    fraction=ImageStat.Stat(mask).mean[0]/255
    text_equal=re.sub(r'\s+','',texts[0])==re.sub(r'\s+','',texts[1])
    row.update(status='raster-equal' if diff.getbbox() is None else 'review-required',normalized_rgb_rmse=rms,changed_pixel_fraction=fraction,ordered_text_equal=text_equal)
    if row['status']!='raster-equal':
     for label,img in [('source',a),('export',b),('difference',diff)]:img.save(destination/f'page-{page:04d}-{label}.png')
   rows.append(row)
 report={'source':str(source),'export':str(exported),'source_info':original,'export_info':result,'pages':rows,'status':'raster-equal' if original['pages']==result['pages'] and all(r['status']=='raster-equal' for r in rows) else 'review-required','limitations':'Static PDF comparison does not verify animations, audio/video, notes, links, accessibility, or editability. Different fonts/render settings can affect raster results. Review flagged pages.'}
 (destination/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'status':report['status'],'pages':len(rows),'flagged_pages':sum(r['status']!='raster-equal' for r in rows),'report':str(destination/'comparison.json')}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('export',type=Path);p.add_argument('destination',type=Path);a=p.parse_args();compare(a.source,a.export,a.destination)
