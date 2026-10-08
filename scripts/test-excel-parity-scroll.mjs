#!/usr/bin/env node
/** Actual import/editor regression: probes owned colored cells after two-axis scrolling and freezing. */
import JSZip from 'jszip';
import {mkdtemp,writeFile,readFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {captureSuiteLeaf} from './capture-suiteleaf-parity.mjs';
const dir=await mkdtemp(join(tmpdir(),'suiteleaf-scroll-regression-'));
try {
 const z=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+[1,2].map(n=>`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>');
 z.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 z.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plain" sheetId="1" r:id="rId1"/><sheet name="Frozen" sheetId="2" r:id="rId2"/></sheets></workbook>`);
 z.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[1,2].map(n=>`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')+'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 z.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0000FF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="2" borderId="0" applyFill="1"/><xf fontId="0" fillId="3" borderId="0" applyFill="1"/></cellXfs></styleSheet>`);
 for(const n of [1,2]){
 const rows=[1,2,40,41,1000].map(r=>`<row r="${r}">`+(r<3?['A','B']:r===1000?['AZ']:['T','U']).map(c=>`<c r="${c}${r}" s="${r<3?1:2}" t="inlineStr"><is><t>${c}${r}</t></is></c>`).join('')+'</row>').join('');
 z.file(`xl/worksheets/sheet${n}.xml`,`<worksheet xmlns="${ns}"><dimension ref="A1:AZ1000"/><sheetViews><sheetView workbookViewId="0">${n===2?'<pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/>':''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" defaultColWidth="11.43"/><sheetData>${rows}</sheetData></worksheet>`);
 }
 const file=join(dir,'owned-scroll.xlsx');await writeFile(file,await z.generateAsync({type:'nodebuffer'}));
 const excelManifest={sheets:[{index:0,name:'Plain',last_row:1000,last_column:52},{index:1,name:'Frozen',last_row:1000,last_column:52}],screenshots:[0,1].flatMap(i=>[{sheet_index:i,sheet_name:i?'Frozen':'Plain',range:'A1:B2',tile_id:'origin'},{sheet_index:i,sheet_name:i?'Frozen':'Plain',range:'T40:U41',tile_id:'far'},{sheet_index:i,sheet_name:i?'Frozen':'Plain',range:'AZ1000:AZ1000',tile_id:'last'}])};
 const m=await captureSuiteLeaf(file,join(dir,'capture'),{excelManifest,deviceScaleFactor:1,url:process.env.SUITELEAF_PARITY_URL??'http://127.0.0.1:5173'});
 assert.equal(m.complete,true,JSON.stringify(m.errors));assert.equal(m.screenshots.length,6);
 const journal=(await readFile(m.checkpoint_journal,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
 assert.equal(journal.filter(e=>e.event==='tile').length,6,'Every captured tile must have an immediate checkpoint');
 for(const sheet of m.sheets){assert.ok(sheet.capture_scroll_margin.capture_rows>sheet.capture_scroll_margin.original_rows);assert.ok(sheet.capture_scroll_margin.capture_columns>sheet.capture_scroll_margin.original_columns);}
 for(const shot of m.screenshots){
 const color=shot.tile_id==='origin'?'red':'blue';
 const ratio=Number(execFileSync('python3',['-c',`from PIL import Image;import sys;i=Image.open(sys.argv[1]).convert('RGB');p=list(i.getdata());print(sum(${color==='red'?'r>220 and g<40 and b<40':'b>220 and r<40 and g<40'} for r,g,b in p)/len(p))`,shot.normalized_path],{encoding:'utf8'}));
 assert.ok(ratio>0.70,`${shot.sheet_name}/${shot.tile_id}: wrong region color ratio ${ratio}`);
 if(shot.sheet_name==='Frozen'&&shot.tile_id==='far'){
 assert.ok(shot.full_grid_path,'Frozen scroll evidence must retain full grid');
 const frozenRedRatio=Number(execFileSync('python3',['-c',"from PIL import Image;import sys;i=Image.open(sys.argv[1]).convert('RGB').crop((3,3,65,35));p=list(i.getdata());print(sum(r>220 and g<40 and b<40 for r,g,b in p)/len(p))",shot.full_grid_path],{encoding:'utf8'}));
 assert.ok(frozenRedRatio>0.65,`Frozen prefix moved during scroll: red ratio ${frozenRedRatio}`);
 assert.ok(shot.scroll_pixels.x>500&&shot.scroll_pixels.y>500,'Far pair did not actually scroll both axes');
 }
 }
 const damaged=await readFile(m.screenshots[0].path);damaged[damaged.length-1]^=1;await writeFile(m.screenshots[0].path,damaged);
 await appendFile(m.checkpoint_journal,'{"event":"tile"');
 const resumed=await captureSuiteLeaf(file,join(dir,'capture'),{excelManifest,deviceScaleFactor:1,url:process.env.SUITELEAF_PARITY_URL??'http://127.0.0.1:5173'});
 assert.equal(resumed.complete,true,JSON.stringify(resumed.errors));assert.equal(resumed.reused_tile_count,5,'Resume should reuse valid records, ignore truncated journal tail, and recapture corrupted PNG');
 assert.equal(resumed.screenshots.length,6);
 console.log(JSON.stringify({passed:true,resume_reused:5,corrupt_tile_recaptured:true,pairs:6,final_content_cell:true,per_tile_checkpoint:true,two_axis_scroll:true,frozen_prefix:true,protocol:m.capture_protocol_hash}));
}finally{await rm(dir,{recursive:true,force:true});}
