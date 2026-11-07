import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

it("ports math metrics generically without changing replacement glyphs or requiring unmapped variants", () => {
  const localPython = process.platform === "win32"
    ? ".venv-fonts/Scripts/python.exe"
    : ".venv-fonts/bin/python";
  const python = process.env.PYTHON ?? (existsSync(localPython) ? localPython : "python3");
  const result = spawnSync(python, ["-c", String.raw`
import sys, io, copy
sys.path.insert(0, 'scripts/fonts')
from suiteleaf_math import copy_math_metrics
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.otlLib.builder import buildMathTable
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables

def face(units, both=False):
    b=FontBuilder(units, isTTF=True)
    names=['.notdef','A']+(['B'] if both else [])
    b.setupGlyphOrder(names); b.setupCharacterMap({65:'A', **({66:'B'} if both else {})})
    glyphs={}
    for name in names:
        p=TTGlyphPen(None);p.moveTo((0,0));p.lineTo((300,0));p.lineTo((150,600));p.closePath();glyphs[name]=p.glyph()
    b.setupGlyf(glyphs);b.setupHorizontalMetrics({n:(500,0) for n in names})
    b.setupHorizontalHeader(ascent=800,descent=-200)
    b.setupNameTable({'familyName':'Synthetic','styleName':'Regular','uniqueFontIdentifier':'Synthetic','fullName':'Synthetic','psName':'Synthetic'})
    b.setupOS2();b.setupPost();b.setupMaxp()
    return b.font

source=face(1000,True);target=face(2000)
before=target['glyf']['A'].compile(target['glyf'])
assert not copy_math_metrics(target,source)
assert 'MATH' not in target
buildMathTable(source, constants={'AxisHeight':250,'ScriptPercentScaleDown':73,'FractionNumeratorDisplayStyleShiftUp':700}, italicsCorrections={'A':30,'B':50},topAccentAttachments={'A':200})
assert copy_math_metrics(target,source)
m=target['MATH'].table
assert m.MathConstants.AxisHeight.Value==500
assert m.MathConstants.FractionNumeratorDisplayStyleShiftUp.Value==1400
assert m.MathConstants.ScriptPercentScaleDown==73
assert m.MathGlyphInfo.MathItalicsCorrectionInfo.Coverage.glyphs==['A']
assert m.MathGlyphInfo.MathItalicsCorrectionInfo.ItalicsCorrection[0].Value==60
assert m.MathGlyphInfo.MathTopAccentAttachment.TopAccentAttachment[0].Value==400
assert m.MathVariants.VertGlyphCount==0 and m.MathVariants.HorizGlyphCount==0
assert before==target['glyf']['A'].compile(target['glyf'])
out=io.BytesIO();target.save(out);loaded=TTFont(io.BytesIO(out.getvalue()));assert loaded['MATH'].table.MathGlyphInfo is not None
# Fonts with constants only still get non-null support tables accepted by browsers.
source['MATH'].table.MathGlyphInfo=None
source['MATH'].table.MathVariants=otTables.MathVariants();source['MATH'].table.MathVariants.populateDefaults();source['MATH'].table.MathVariants.MinConnectorOverlap=100
assert copy_math_metrics(target,source)
assert target['MATH'].table.MathVariants.MinConnectorOverlap==200
assert target['MATH'].table.MathGlyphInfo is not None
print('math metrics preserved; replacement outlines unchanged')
`], { encoding: "utf8", timeout: 30_000 });
  expect(result.status, `${result.error?.message ?? ""}\n${result.stderr}\nRun npm run setup:test-fonts to install the font test dependencies.`).toBe(0);
  expect(result.stdout).toContain("replacement outlines unchanged");
});
