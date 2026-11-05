"""Retain mathematical layout metrics on independently drawn SuiteLeaf glyphs.

Only Unicode-mapped glyph metrics are transferred. Assembly/variant glyphs that
the replacement face does not contain are deliberately not fabricated or copied.
"""
import copy

from fontTools.otlLib.builder import buildMathTable
from fontTools.ttLib.tables import otTables


def copy_math_metrics(font, reference):
    """Preserve source math constants and mapped corrections, in target units.

    Returns False for ordinary text faces. Does not modify outlines, cmap,
    advances, naming, or any non-math table. Valid empty support containers are
    required even when the face has no mapped accent/italic/variant glyph data.
    """
    if "MATH" not in reference:
        return False
    source = reference["MATH"].table
    ratio = font["head"].unitsPerEm / reference["head"].unitsPerEm
    cmap = font.getBestCmap() or {}
    names = {name: cmap[code] for code, name in (reference.getBestCmap() or {}).items() if code in cmap}
    info = source.MathGlyphInfo

    def corrections(name, values):
        table = getattr(info, name, None) if info else None
        if table is None:
            return {}
        return {
            names[glyph]: round(value.Value * ratio)
            for glyph, value in zip((getattr(table, "Coverage", None) or table.TopAccentCoverage).glyphs, getattr(table, values))
            if glyph in names
        }

    variants = source.MathVariants
    overlap = round(variants.MinConnectorOverlap * ratio) if variants else 0
    buildMathTable(
        font,
        italicsCorrections=corrections("MathItalicsCorrectionInfo", "ItalicsCorrection"),
        topAccentAttachments=corrections("MathTopAccentAttachment", "TopAccentAttachment"),
        minConnectorOverlap=overlap,
    )
    result = font["MATH"].table
    constants = copy.deepcopy(source.MathConstants)
    percentages = {"ScriptPercentScaleDown", "ScriptScriptPercentScaleDown", "RadicalDegreeBottomRaisePercent"}
    for name, value in vars(constants).items():
        if hasattr(value, "Value"):
            value.Value = round(value.Value * ratio)
        elif isinstance(value, int) and name not in percentages:
            setattr(constants, name, round(value * ratio))
    result.MathConstants = constants
    if result.MathGlyphInfo is None:
        result.MathGlyphInfo = otTables.MathGlyphInfo()
        result.MathGlyphInfo.populateDefaults()
    result.MathVariants = otTables.MathVariants()
    result.MathVariants.populateDefaults()
    result.MathVariants.MinConnectorOverlap = overlap
    result.MathVariants.VertGlyphCount = 0
    result.MathVariants.HorizGlyphCount = 0
    return True
