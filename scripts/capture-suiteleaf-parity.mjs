#!/usr/bin/env node
/** Actual SuiteLeaf editor capture. Usage: node scripts/capture-suiteleaf-parity.mjs FILE OUTPUT_DIR [EXCEL_MANIFEST]
 * No application source is changed. An external Vite response hook exposes the already-created editor facade.
 * Evidence describes actual visible ranges; requested Excel ranges are never asserted covered without checking.
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, relative, join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
const sourceFingerprint = () => JSON.parse(execFileSync('python3', ['scripts/excel-parity-db.py', 'fingerprint'], {cwd:root,encoding:'utf8'}));

const root = resolve(new URL('..', import.meta.url).pathname);
const colName = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const label = r => `${colName(r.startColumn)}${r.startRow + 1}:${colName(r.endColumn)}${r.endRow + 1}`;
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const attr = (s, a) => decode(new RegExp(`(?:^|\\s)${a}="([^"]*)"`).exec(s)?.[1] ?? '');
function a1Bounds(s) { s=s.replaceAll('$',''); const m = /([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/.exec(s); if (!m) return null; const c = s => [...s].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0)-1; return {startRow:+m[2]-1,startColumn:c(m[1]),endRow:+(m[4]??m[2])-1,endColumn:c(m[3]??m[1])}; }
async function sourceSheets(file) {
  try {
    const zip = await JSZip.loadAsync(await readFile(file));
    const book = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const targets = Object.fromEntries([...rels.matchAll(/<Relationship\b([^>]*)/g)].map(m=>[attr(m[1],'Id'),attr(m[1],'Target')]));
    return await Promise.all([...book.matchAll(/<sheet\b([^>]*)/g)].map(async (m,index)=> {
      const target=targets[attr(m[1],'r:id')]; const path=target?.startsWith('/')?target.slice(1):posix.normalize(`xl/${target}`);
      const xml=await zip.file(path)?.async('string');
      let endRow=0,endColumn=0;
      for (const ref of xml?.matchAll(/<(?:c|mergeCell|dimension)\b[^>]*\b(?:r|ref)="([A-Z]+\d+(?::[A-Z]+\d+)?)"/g)??[]) { const r=a1Bounds(ref[1]);endRow=Math.max(endRow,r.endRow);endColumn=Math.max(endColumn,r.endColumn); }
      let drawingExtentVerified=true;
      if (/<(?:drawing|legacyDrawing)\b/.test(xml??'')) {
        const relpath=posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels');
        const relxml=await zip.file(relpath)?.async('string')??'';
        for(const rel of relxml.matchAll(/<Relationship\b([^>]*)/g)) {
          if(!attr(rel[1],'Type').endsWith('/drawing'))continue;
          const t=attr(rel[1],'Target'),dp=t.startsWith('/')?t.slice(1):posix.normalize(posix.join(posix.dirname(path),t));
          const dx=await zip.file(dp)?.async('string')??'';
          for(const row of dx.matchAll(/<(?:\w+:)?row>(\d+)<\//g))endRow=Math.max(endRow,+row[1]);
          for(const col of dx.matchAll(/<(?:\w+:)?col>(\d+)<\//g))endColumn=Math.max(endColumn,+col[1]);
          if(/<(?:\w+:)?(?:absoluteAnchor|oneCellAnchor)\b/.test(dx)||!dx)drawingExtentVerified=false;
        }
        if(/<legacyDrawing\b/.test(xml??''))drawingExtentVerified=false;
      }
      return {index,name:attr(m[1],'name'),visibility:attr(m[1],'state')||'visible',bounds:{startRow:0,startColumn:0,endRow,endColumn},drawing_extent_verified:drawingExtentVerified};
    }));
  } catch { return null; }
}
export async function captureSuiteLeaf(file, outputDir, options = {}) {
  file=resolve(file);outputDir=resolve(outputDir);await mkdir(outputDir,{recursive:true});
  const fingerprintStart=sourceFingerprint();
  const captureRevisionStart=fingerprintStart.suiteleaf_revision;
  const captureProtocolHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
  const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');
  const source=await sourceSheets(file);
  const declaredScale=options.excelManifest?.capture_settings?.device_scale_factor??options.excelManifest?.screenshots?.[0]?.device_scale_factor;
  let deviceScaleFactor=options.deviceScaleFactor??declaredScale??1;
  const native=options.excelManifest?.screenshots?.find(t=>t.native_bounds&&t.path);
  if(options.deviceScaleFactor===undefined&&declaredScale===undefined&&native){const png=await readFile(native.path);const logical=native.native_bounds.Width??(native.native_bounds[2]-native.native_bounds[0]);if(logical>0)deviceScaleFactor=png.readUInt32BE(16)/logical;}
  const manifest={application:'suiteleaf',filename:relative(root,file),complete:false,sheets:[],screenshots:[],errors:[],audit_revision_start:fingerprintStart.audit_revision,capture_protocol_version:2,capture_protocol_hash:captureProtocolHash,capture_revision_start:captureRevisionStart,capture_settings:{zoom:100,device_scale_factor:deviceScaleFactor,appearance:'light',viewport:options.viewport??{width:1800,height:1200},supplemental_readability:!!options.excelManifest?.capture_settings?.supplemental_readability,method:'actual browser UI import and Univer editor'},attempts:0};
  // Read only complete newline records. A killed append may leave a partial
  // trailing record, which is not a committed checkpoint and must be recaptured.
  const reusable=new Map();
  if(options.resume!==false)for(const attempt of [1,2])try{
    const text=await readFile(join(outputDir,`capture-attempt-${attempt}.ndjson`),'utf8');
    const records=text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const header=records[0];
    if(header?.source_sha256!==sourceHash||header.audit_revision!==fingerprintStart.audit_revision||header.suiteleaf_revision!==captureRevisionStart||JSON.stringify(header.capture_settings)!==JSON.stringify(manifest.capture_settings))continue;
    for(const record of records)if(record.event==='tile'){
      const shot=record.screenshot,raw=await readFile(shot.path),normalized=await readFile(shot.normalized_path);
      if(createHash('sha256').update(raw).digest('hex')!==shot.image_hash||createHash('sha256').update(normalized).digest('hex')!==shot.normalized_image_hash)continue;
      if(shot.full_grid_path&&createHash('sha256').update(await readFile(shot.full_grid_path)).digest('hex')!==shot.full_grid_image_hash)continue;
      reusable.set(`${shot.sheet_index}:${shot.tile_id}:${shot.range}`,shot);
    }
  }catch{/* Absent/corrupt evidence is recaptured rather than counted. */}
  manifest.reused_tile_count=0;
  for(let attempt=1;attempt<=2;attempt++) {
    manifest.attempts=attempt;let browser;
    try {
      browser=await chromium.launch({headless:true});
      const context=await browser.newContext({viewport:manifest.capture_settings.viewport,deviceScaleFactor,colorScheme:'light'});
      const page=await context.newPage();
      await page.route('**/src/editors/Sheets.tsx*',async route=>{
        const response=await route.fetch();const body=await response.text();
        if(!body.includes('book.current = workbook;'))throw Error('Audit facade hook unavailable in served module');
        await route.fulfill({response,body:body.replace('book.current = workbook;','book.current = workbook; window.__suiteleafAudit = {univerAPI, workbook, content: content.current};')});
      });
      await page.goto(options.url??process.env.SUITELEAF_PARITY_URL??'http://127.0.0.1:5173',{waitUntil:'networkidle'});
      await page.locator('input[type=file]').first().setInputFiles(file);
      await page.waitForFunction(()=>window.__suiteleafAudit||!!document.querySelector('[role=alert]')||!!document.querySelector('dialog.office-password-dialog[open]'),null,{timeout:45000});
      if(await page.locator('dialog.office-password-dialog[open]').count()) {
        if(options.password===undefined)throw Error('SuiteLeaf requests an Office password; provide documented password through capture options');
        await page.getByLabel('Password',{exact:true}).fill(options.password);
        await page.getByRole('button',{name:'Open file',exact:true}).click();
        await page.waitForFunction(()=>window.__suiteleafAudit||!!document.querySelector('[role=alert]')||!!document.querySelector('dialog.office-password-dialog[open]'),null,{timeout:45000});
        if(await page.locator('dialog.office-password-dialog[open]').count())throw Error('SuiteLeaf rejected the provided Office password');
      }
      if(!await page.evaluate(()=>!!window.__suiteleafAudit))throw Error(`SuiteLeaf import rejected: ${(await page.locator('body').innerText()).slice(-3000)}`);
      await page.waitForTimeout(800);
      // The facade can exist before render controllers are registered. Probe the actual
      // scrolling capability with a deadline rather than sleeping for an assumed duration.
      await page.waitForFunction(()=>{try{const s=window.__suiteleafAudit.workbook.getActiveSheet();s.scrollToCell(0,0,0);return !!s.getVisibleRange();}catch{return false;}},null,{timeout:60000,polling:250});
      const imported=await page.evaluate(()=>{const w=window.__suiteleafAudit.workbook;const snap=w.save();return w.getSheets().map((s,index)=>{const snapshot=snap.sheets[s.getSheetId()];let endRow=0,endColumn=0;for(const [r,cells]of Object.entries(snapshot.cellData??{})){endRow=Math.max(endRow,+r);for(const c of Object.keys(cells))endColumn=Math.max(endColumn,+c);}return {index,id:s.getSheetId(),name:s.getSheetName(),visibility:['visible','hidden','veryHidden'][s.getHiddenState()]??String(s.getHiddenState()),snapshot:{...snapshot,cellData:undefined},cell_bounds:{endRow,endColumn}};})});
      manifest.sheets=[];manifest.screenshots=[];manifest.errors=[];
      const journal=join(outputDir,`capture-attempt-${attempt}.ndjson`);
      manifest.checkpoint_journal=journal;
      await writeFile(journal,JSON.stringify({event:'start',filename:manifest.filename,source_sha256:sourceHash,attempt,audit_revision:manifest.audit_revision_start,suiteleaf_revision:manifest.capture_revision_start,capture_settings:manifest.capture_settings})+'\n');
      for(const sheet of source??imported) {
        const match=imported.find(s=>s.name===sheet.name);
        const entry={index:sheet.index,name:sheet.name,visibility:sheet.visibility,expected_tiles:[],excel_complete:false,suiteleaf_complete:false};manifest.sheets.push(entry);
        if(!match){entry.error='Sheet missing after SuiteLeaf import';manifest.errors.push(`${sheet.name}: ${entry.error}`);continue;}
        try {
          await page.evaluate(id=>{const w=window.__suiteleafAudit.workbook;const s=w.getSheetBySheetId(id);s.showSheet();w.setActiveSheet(s);s.zoom(1);window.__suiteleafAudit.univerAPI.executeCommand('sheet.operation.set-selections',{unitId:w.getId(),subUnitId:id,selections:[],reveal:false});s.scrollToCell(0,0,0)},match.id);await page.waitForTimeout(400);
          const reference=options.excelManifest?.sheets?.find(s=>s.name?s.name===sheet.name:s.index===sheet.index);
          if(reference?.supplemental&&reference.column_widths_points){
            await page.evaluate(({id,widths})=>{const s=window.__suiteleafAudit.workbook.getSheetBySheetId(id);widths.forEach((w,c)=>s.setColumnWidth(c,w*96/72));},{id:match.id,widths:reference.column_widths_points});
            if(reference.wrap_text) await page.evaluate(({id,rows,columns,heights})=>{const s=window.__suiteleafAudit.workbook.getSheetBySheetId(id);s.getRange(0,0,rows,columns).setWrap(true);heights?.forEach((h,r)=>s.setRowHeight(r,h*96/72));},{id:match.id,rows:reference.last_row,columns:reference.last_column,heights:reference.row_heights_points});
            entry.supplemental=true;entry.column_widths_points=reference.column_widths_points;entry.row_heights_points=reference.row_heights_points;entry.wrap_text=reference.wrap_text;await page.waitForTimeout(220);
          }
          const bounds={...((reference?.last_row&&reference?.last_column?{startRow:0,startColumn:0,endRow:reference.last_row-1,endColumn:reference.last_column-1}:a1Bounds(reference?.content_bounds??reference?.used_range??''))??sheet.bounds??{startRow:0,startColumn:0,endRow:0,endColumn:0})};
          bounds.endRow=Math.max(bounds.endRow,match.cell_bounds.endRow);bounds.endColumn=Math.max(bounds.endColumn,match.cell_bounds.endColumn);
          // Imported floating objects can extend beyond populated cells. Include their original pixel footprint.
          const objects=await page.evaluate(id=>window.__suiteleafAudit.content.charts?.filter(c=>c.sheetId===id).map(c=>({endX:c.x+c.width,endY:c.y+c.height}))??[],match.id);
          for(const o of objects){bounds.endRow=Math.max(bounds.endRow,Math.ceil(o.endY/(match.snapshot.defaultRowHeight??24)));bounds.endColumn=Math.max(bounds.endColumn,Math.ceil(o.endX/(match.snapshot.defaultColumnWidth??100)));}
          entry.content_bounds=label(bounds);entry.original_freeze=match.snapshot.freeze??null;
          // Add only blank scroll margin beyond the evidence bounds in the disposable
          // browser document. Without it, bottom/right clamping can hide final cells.
          entry.capture_scroll_margin=await page.evaluate(({id,bounds,viewport})=>{const s=window.__suiteleafAudit.workbook.getSheetBySheetId(id),originalRows=s.getMaxRows(),originalColumns=s.getMaxColumns();const rows=Math.max(originalRows,Math.min(1048576,bounds.endRow+Math.ceil(viewport.height/10)+5)),columns=Math.max(originalColumns,Math.min(16384,bounds.endColumn+Math.ceil(viewport.width/10)+5));if(rows>originalRows)s.setRowCount(rows);if(columns>originalColumns)s.setColumnCount(columns);return {original_rows:originalRows,original_columns:originalColumns,capture_rows:rows,capture_columns:columns,content_bounds_unchanged:true};},{id:match.id,bounds,viewport:manifest.capture_settings.viewport});
          await appendFile(journal,JSON.stringify({event:'sheet',sheet:entry})+'\n');
          if(sheet.drawing_extent_verified===false&&!options.excelManifest) entry.object_extent_unverified=true;
          const requests=options.excelManifest?.screenshots?.filter(t=>t.sheet_name?t.sheet_name===sheet.name:t.sheet_index===sheet.index);
          const queue=requests?.length?requests.map(t=>({range:typeof t.range==='string'?a1Bounds(t.range):t.range,tile_id:t.tile_id})): [{range:{startRow:0,startColumn:0},tile_id:0}];
          const visited=new Set(); let tile=0;
          while(queue.length) {
            const request=queue.shift(),r=request.range;if(!r)throw Error('Invalid requested range');
            const key=`${r.startRow},${r.startColumn}`;if(visited.has(key))continue;visited.add(key);
            await page.evaluate(({id,r})=>window.__suiteleafAudit.workbook.getSheetBySheetId(id).scrollToCell(r.startRow,r.startColumn,0),{id:match.id,r});await page.waitForTimeout(220);
            const view=await page.evaluate(({id,requested,rtl,freeze})=>{
              const s=window.__suiteleafAudit.workbook.getSheetBySheetId(id),v=s.getVisibleRange();
              const canvas=[...document.querySelectorAll('.sheet-host canvas')].filter(c=>c.getBoundingClientRect().height>100).sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];if(!canvas||!v)throw Error('Grid viewport unavailable');
              const box=canvas.getBoundingClientRect();const first=JSON.parse(s.getRange(v.startRow,v.startColumn,1,1).getCellRect().toJSON());
              // Last visible row/column can be partial. Remove it from coverage and overlap it in the next tile.
              const range={...v,endRow:Math.max(v.startRow,v.endRow-1),endColumn:Math.max(v.startColumn,v.endColumn-1)};
              const all=[...s.getVisibleRangesOfAllViewports()].map(([viewport,range])=>({viewport,range}));
              const absoluteRect=(row,col)=>JSON.parse(s.getRange(row,col,1,1).getCellRect().toJSON());
              const state=s.getScrollState(),fr=freeze?.ySplit??0,fc=freeze?.xSplit??0;
              const base=absoluteRect(fr,fc),start=absoluteRect(state.sheetViewStartRow+fr,state.sheetViewStartColumn+fc);
              const scrollX=start.left-base.left+state.offsetX,scrollY=start.top-base.top+state.offsetY;
              // getCellRect is in absolute sheet space. Translate scrollable
              // cells into viewport space; frozen prefix cells do not scroll.
              const cellRect=(row,col)=>{const a=absoluteRect(row,col),dx=col>=fc?scrollX:0,dy=row>=fr?scrollY:0;return {...a,left:a.left-dx,right:a.right-dx,top:a.top-dy,bottom:a.bottom-dy};};
              const gridLeft=box.x+(rtl?16:46),gridRight=box.right-(rtl?46:16);
              let clip={x:gridLeft,y:box.y+20,width:gridRight-gridLeft,height:box.height-20-16};
              const fullGridClip={...clip};
              if(requested?.endRow!==undefined){const a=cellRect(requested.startRow,requested.startColumn),z=cellRect(requested.endRow,requested.endColumn);clip={x:box.x+Math.min(a.left,z.left),y:box.y+Math.min(a.top,z.top),width:Math.max(a.right,z.right)-Math.min(a.left,z.left),height:Math.max(a.bottom,z.bottom)-Math.min(a.top,z.top)};if(clip.x<gridLeft||clip.y<box.y+20||clip.x+clip.width>gridRight||clip.y+clip.height>box.bottom-16)throw Error('Paired range pixels do not fit unobscured grid viewport');}
              return {range,viewport_ranges:all,clip,full_grid_clip:fullGridClip,first,scroll_state:state,scroll_pixels:{x:scrollX,y:scrollY}};
            },{id:match.id,requested:requests?.length?r:null,rtl:match.snapshot.rightToLeft===1,freeze:match.snapshot.freeze});
            const covered=view.range;
            const visible=view.viewport_ranges.map(v=>v.range);
            const contains=(row,col)=>visible.some(v=>v.startRow<=row&&v.endRow>=row&&v.startColumn<=col&&v.endColumn>=col);
            if(!contains(r.startRow,r.startColumn))throw Error(`Scroll failed to expose ${label({...r,endRow:r.startRow,endColumn:r.startColumn})}; actual ${label(covered)}`);
            const screenshotClip={...view.clip,width:Math.ceil(view.clip.width),height:Math.ceil(view.clip.height)};
            const tileId=String(request.tile_id??`r${r.startRow+1}c${r.startColumn+1}`),rangeLabel=label(requests?.length?r:covered);
            const reused=reusable.get(`${sheet.index}:${tileId}:${rangeLabel}`);
            if(reused){manifest.screenshots.push(reused);manifest.reused_tile_count++;tile++;}
            else {
            const png=join(outputDir,`suiteleaf-sheet-${sheet.index}-tile-${tile}.png`);await page.screenshot({path:png,clip:screenshotClip});
            let fullGridPath;
            if(match.snapshot.freeze?.xSplit||match.snapshot.freeze?.ySplit){fullGridPath=join(outputDir,`suiteleaf-sheet-${sheet.index}-tile-${tile}-full-grid.png`);await page.screenshot({path:fullGridPath,clip:view.full_grid_clip});}
            const normalizedPath=join(outputDir,`suiteleaf-sheet-${sheet.index}-tile-${tile}-96dpi.png`);
            execFileSync('python3',['-c','from PIL import Image; import sys; i=Image.open(sys.argv[1]); scale=float(sys.argv[3]); i.resize((round(i.width/scale),round(i.height/scale)),Image.Resampling.LANCZOS).save(sys.argv[2])',png,normalizedPath,String(deviceScaleFactor)]);
            manifest.screenshots.push({application:'suiteleaf',sheet_index:sheet.index,sheet_name:sheet.name,visibility:sheet.visibility,range:label(requests?.length?r:covered),visible_range:label(covered),requested_range:requests?.length?label(r):null,tile_id:String(request.tile_id??`r${r.startRow+1}c${r.startColumn+1}`),path:png,normalized_path:normalizedPath,full_grid_path:fullGridPath,scroll_state:view.scroll_state,scroll_pixels:view.scroll_pixels,device_scale_factor:deviceScaleFactor,comparison_dpi:96,image_hash:createHash('sha256').update(await readFile(png)).digest('hex'),normalized_image_hash:createHash('sha256').update(await readFile(normalizedPath)).digest('hex'),full_grid_image_hash:fullGridPath?createHash('sha256').update(await readFile(fullGridPath)).digest('hex'):undefined,visible_ranges:view.viewport_ranges,viewport_ranges:view.viewport_ranges,crop:screenshotClip,requested_cell_rect:view.clip,paired_exact_crop:!!requests?.length});tile++;
            }
            if(requests?.length){
              const rows=[r.startRow,r.endRow+1,...visible.flatMap(v=>[v.startRow,v.endRow+1])].filter(n=>n>=r.startRow&&n<=r.endRow+1).sort((a,b)=>a-b);
              const cols=[r.startColumn,r.endColumn+1,...visible.flatMap(v=>[v.startColumn,v.endColumn+1])].filter(n=>n>=r.startColumn&&n<=r.endColumn+1).sort((a,b)=>a-b);
              for(const row of rows.slice(0,-1))for(const col of cols.slice(0,-1))if(!contains(row,col))throw Error(`Excel requested tile ${label(r)} has cells outside actual visible viewports`);
            }
            else {
              if(covered.endColumn<bounds.endColumn)queue.push({range:{startRow:r.startRow,startColumn:Math.max(r.startColumn+1,covered.endColumn)},tile_id:undefined});
              if(r.startColumn===0&&covered.endRow<bounds.endRow)queue.push({range:{startRow:Math.max(r.startRow+1,covered.endRow),startColumn:0},tile_id:undefined});
            }
            // A complete newline record commits this tile after pixel and coverage checks.
            await appendFile(journal,JSON.stringify({event:'tile',sheet_index:sheet.index,screenshot:manifest.screenshots.at(-1)})+'\n');
          }
          entry.expected_tiles=manifest.screenshots.filter(t=>t.sheet_index===sheet.index).map(t=>t.tile_id);entry.suiteleaf_complete=!entry.object_extent_unverified;
          if(entry.object_extent_unverified)throw Error('Original drawing extents require Excel paired manifest; SuiteLeaf imported no chart extents');
        }catch(e){entry.error=e.message;manifest.errors.push(`${sheet.name}: ${e.message}`);}
        await appendFile(journal,JSON.stringify({event:'sheet_end',sheet:entry})+'\n');
      }
      manifest.complete=manifest.sheets.length>0&&manifest.sheets.every(s=>s.suiteleaf_complete);
      await browser.close();browser=null;
      if(manifest.complete||attempt===2)break;
    }catch(e){manifest.errors.push(e.message);if(browser)await browser.close();}
  }
  const fingerprintEnd=sourceFingerprint();
  manifest.suiteleaf_revision=fingerprintEnd.suiteleaf_revision;manifest.audit_revision=fingerprintEnd.audit_revision;
  if(manifest.audit_revision!==manifest.audit_revision_start){manifest.complete=false;manifest.errors.push('Capture helper fingerprint changed during capture; recapture required');}
  if(manifest.suiteleaf_revision!==captureRevisionStart){manifest.complete=false;manifest.errors.push('SuiteLeaf source fingerprint changed during capture; recapture required');}
  await writeFile(join(outputDir,'suiteleaf-manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
if(process.argv[1]===new URL(import.meta.url).pathname){const args=process.argv.slice(2);const passwordIndex=args.indexOf('--password');let password=process.env.SUITELEAF_PARITY_PASSWORD;if(passwordIndex>=0){password=args[passwordIndex+1];if(password===undefined)throw Error('--password requires a value');args.splice(passwordIndex,2);}const [file,out,paired]=args;if(!file||!out)throw Error('Usage: FILE OUTPUT_DIR [EXCEL_MANIFEST] [--password VALUE]');const result=await captureSuiteLeaf(file,out,{password,excelManifest:paired?JSON.parse(await readFile(paired,'utf8')):undefined});console.log(JSON.stringify({manifest:join(resolve(out),'suiteleaf-manifest.json'),complete:result.complete,sheets:result.sheets,screenshot_count:result.screenshots.length,errors:result.errors}));if(!result.complete)process.exitCode=2;}
