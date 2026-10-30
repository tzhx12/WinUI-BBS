"""Build the Segoe-codepoint bridge from MIT-licensed Fluent System Icons SVGs.

Requires fonttools==4.58.1. Normal application builds use the committed WOFF.
"""

import json
import re
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import SVGPath

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "icons/fluent-system-icons.json").read_text("utf-8"))
package = ROOT.parents[1] / "node_modules/@fluentui/svg-icons"
metadata = json.loads((package / "package.json").read_text("utf-8"))
if metadata["version"] != manifest["version"]:
    raise ValueError("Fluent SVG package version differs from the icon manifest")

units = 1024
ascent = 896
descent = -128
font = FontBuilder(units, isTTF=True)
names = sorted(set(manifest["glyphs"].values()))
font.setupGlyphOrder([".notdef", *names])
font.setupCharacterMap({int(code, 16): name for code, name in manifest["glyphs"].items()})
glyphs = {".notdef": TTGlyphPen(None).glyph()}
for name in names:
    svg = package / "icons" / f"{name}.svg"
    size = int(name.split("_")[-2])
    pen = TTGlyphPen(None)
    quadratic = Cu2QuPen(pen, max_err=0.5, reverse_direction=True)
    transform = TransformPen(quadratic, (units / size, 0, 0, -units / size, 0, ascent))
    path = SVGPath(svg)
    # SVGO can emit "zh...z": a new subpath after close without a moveto.
    # Make that implicit start explicit for FontTools' SVG parser.
    for element in path.root.iter():
        if "d" in element.attrib:
            element.attrib["d"] = re.sub(r"([zZ])(?=\s*[hHvVcCsSqQtTaAlL])", r"\1m0 0", element.attrib["d"])
    path.draw(transform)
    glyphs[name] = pen.glyph()

font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (units, 0) for name in glyphs})
# Keep the SVG's original horizontal padding rather than shifting each outline left.
for name, glyph in glyphs.items():
    if glyph.numberOfContours:
        glyph.recalcBounds(font.font["glyf"])
        font.font["hmtx"].metrics[name] = (units, glyph.xMin)
font.setupHorizontalHeader(ascent=ascent, descent=descent)
font.setupNameTable({
    "familyName": "Fluent UI System Icons Forum",
    "styleName": "Regular",
    "uniqueFontIdentifier": f"FluentUISystemIconsForum-{manifest['version']}",
    "fullName": "Fluent UI System Icons Forum Regular",
    "psName": "FluentUISystemIconsForum-Regular",
    "version": f"Version {manifest['version']}",
    "copyright": "Copyright (c) Microsoft Corporation. Derived from Fluent System Icons (MIT).",
    "licenseDescription": "MIT License; see licenses/fluent-system-icons-MIT.txt",
    "licenseInfoURL": "https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE",
})
font.setupOS2(sTypoAscender=ascent, sTypoDescender=descent, usWinAscent=ascent,
              usWinDescent=-descent, fsSelection=0x40)
font.setupPost()
font.setupMaxp()
font.font.flavor = "woff"
output = ROOT / "src/assets/fluent-system-icons.woff"
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
print(f"Built {output.relative_to(ROOT)}: {len(manifest['glyphs'])} codepoints, {output.stat().st_size} bytes")
