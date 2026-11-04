import type { PresetDef } from "./pptx-preset-data";

/** DrawingML mathematical operators; formulas follow ECMA-376 preset definitions. */
export const mathPlusPreset: PresetDef = {
  adj: {
    adj1: 23520,
  },
  guides: [
    ["a1", "pin", 0, "adj1", 73490],
    ["dx1", "*/", "w", 73490, 200000],
    ["dy1", "*/", "h", 73490, 200000],
    ["dx2", "*/", "ss", "a1", 200000],
    ["x1", "+-", "hc", 0, "dx1"],
    ["x2", "+-", "hc", 0, "dx2"],
    ["x3", "+-", "hc", "dx2", 0],
    ["x4", "+-", "hc", "dx1", 0],
    ["y1", "+-", "vc", 0, "dy1"],
    ["y2", "+-", "vc", 0, "dx2"],
    ["y3", "+-", "vc", "dx2", 0],
    ["y4", "+-", "vc", "dy1", 0],
  ],
  rect: ["x1", "y2", "x4", "y3"],
  paths: [
    {
      fill: true,
      stroke: true,
      cmds: [
        ["M", "x1", "y2"],
        ["L", "x2", "y2"],
        ["L", "x2", "y1"],
        ["L", "x3", "y1"],
        ["L", "x3", "y2"],
        ["L", "x4", "y2"],
        ["L", "x4", "y3"],
        ["L", "x3", "y3"],
        ["L", "x3", "y4"],
        ["L", "x2", "y4"],
        ["L", "x2", "y3"],
        ["L", "x1", "y3"],
        ["Z"],
      ],
    },
  ],
};
export const mathEqualPreset: PresetDef = {
  adj: {
    adj1: 23520,
    adj2: 11760,
  },
  guides: [
    ["a1", "pin", 0, "adj1", 36745],
    ["2a1", "*/", "a1", 2, 1],
    ["mAdj2", "+-", 100000, 0, "2a1"],
    ["a2", "pin", 0, "adj2", "mAdj2"],
    ["dy1", "*/", "h", "a1", 100000],
    ["dy2", "*/", "h", "a2", 200000],
    ["dx1", "*/", "w", 73490, 200000],
    ["y2", "+-", "vc", 0, "dy2"],
    ["y3", "+-", "vc", "dy2", 0],
    ["y1", "+-", "y2", 0, "dy1"],
    ["y4", "+-", "y3", "dy1", 0],
    ["x1", "+-", "hc", 0, "dx1"],
    ["x2", "+-", "hc", "dx1", 0],
    ["yC1", "+/", "y1", "y2", 2],
    ["yC2", "+/", "y3", "y4", 2],
  ],
  rect: ["x1", "y1", "x2", "y4"],
  paths: [
    {
      fill: true,
      stroke: true,
      cmds: [
        ["M", "x1", "y1"],
        ["L", "x2", "y1"],
        ["L", "x2", "y2"],
        ["L", "x1", "y2"],
        ["Z"],
        ["M", "x1", "y3"],
        ["L", "x2", "y3"],
        ["L", "x2", "y4"],
        ["L", "x1", "y4"],
        ["Z"],
      ],
    },
  ],
};
