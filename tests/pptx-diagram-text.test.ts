import {expect,it} from "vitest";
import {diagramTextElement} from "../packages/core/src/pptx-diagram-text";
import {officeSingleSpacing} from "../packages/core/src/office-fonts";

it("keeps exact diagram leading independent of font grid and preserves paragraph runs",()=>{
 const element=diagramTextElement('<a:bodyPr anchor="b" wrap="none" lIns="0" rIns="12000" tIns="0" bIns="24000"/>',[
  {text:"One",runs:[{text:"One"}],size:20,font:"Arial",lineHeight:1.5,exactLine:true,underline:true},
  {text:"Two",runs:[{text:"Two"}],bullet:true},
 ],{x:1,y:2,width:100,height:50},{width:960,emuWidth:9144000},"#abcabc");
 expect(element).toMatchObject({lineHeight:1.5,valign:"bottom",nowrap:true,content:"One\nTwo",underline:true,color:"#abcabc",bullet:true,padLeft:0,padRight:12000/9525,padBottom:24000/9525});
 expect(element.runs).toEqual([{text:"One"},{text:"\n",paragraphBreak:true},{text:"Two"}]);
 const fallback=diagramTextElement("",[{text:"x",runs:[],lineHeight:.9}],{x:0,y:0,width:1,height:1},{width:960,emuWidth:9144000});
 expect(fallback).toMatchObject({fontSize:18,fontFamily:"Arial",color:"#1e293b",lineHeight:.9*officeSingleSpacing("Arial")});
 expect(fallback.inset).toBeUndefined();
});
