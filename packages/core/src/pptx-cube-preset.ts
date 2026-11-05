import type { PresetDef } from "./pptx-preset-data";

/** DrawingML cube: the adjustment is depth as a fraction of the short side. */
export const cubePreset: PresetDef = {
  adj: { adj: 25000 },
  guides: [
    ["a", "pin", 0, "adj", 100000],
    ["depth", "*/", "ss", "a", 100000],
    ["frontRight", "+-", "r", 0, "depth"],
    ["backBottom", "+-", "b", 0, "depth"],
  ],
  rect: ["l", "depth", "frontRight", "b"],
  paths: [
    { fill: true, stroke: false, cmds: [
      ["M", "l", "depth"], ["L", "frontRight", "depth"],
      ["L", "frontRight", "b"], ["L", "l", "b"], ["Z"],
    ] },
    { fill: true, stroke: false, cmds: [
      ["M", "frontRight", "depth"], ["L", "r", "t"],
      ["L", "r", "backBottom"], ["L", "frontRight", "b"], ["Z"],
    ] },
    { fill: true, stroke: false, cmds: [
      ["M", "l", "depth"], ["L", "depth", "t"],
      ["L", "r", "t"], ["L", "frontRight", "depth"], ["Z"],
    ] },
    { fill: false, stroke: true, cmds: [
      ["M", "l", "depth"], ["L", "depth", "t"], ["L", "r", "t"],
      ["L", "r", "backBottom"], ["L", "frontRight", "b"],
      ["L", "l", "b"], ["Z"], ["M", "l", "depth"],
      ["L", "frontRight", "depth"], ["L", "r", "t"],
      ["M", "frontRight", "depth"], ["L", "frontRight", "b"],
    ] },
  ],
};
