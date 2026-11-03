import { expect, it } from "vitest";
import {
  emfQuadGradient,
  readEmfGradientVertices,
  type EmfGradientVertex,
} from "../packages/core/src/emf-gradient";

function vertex(x: number, y: number, color: string): EmfGradientVertex {
  return { x, y, color };
}

function record(verts: Array<[number, number, number, number, number]>): DataView {
  const bytes = new Uint8Array(36 + verts.length * 16);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length, true);
  view.setUint32(24, verts.length, true);
  verts.forEach(([x, y, r, g, b], index) => {
    const at = 36 + index * 16;
    view.setInt32(at, x, true);
    view.setInt32(at + 4, y, true);
    view.setUint16(at + 8, r << 8, true);
    view.setUint16(at + 10, g << 8, true);
    view.setUint16(at + 12, b << 8, true);
  });
  return view;
}

it("reads gradient vertices and drops coordinates that cannot sit on a page", () => {
  const view = record([
    [0, 10, 0x36, 0xa8, 0xe1],
    [2_000_000, 10, 1, 2, 3],
    [40, 30, 0xfe, 0xfe, 0xfe],
  ]);
  expect(readEmfGradientVertices(view, 0, view.byteLength)).toEqual([
    vertex(0, 10, "#36a8e1"),
    vertex(40, 30, "#fefefe"),
  ]);
  expect(readEmfGradientVertices(view, 0, 40)).toEqual([]);
  expect(readEmfGradientVertices(view, 0, 60)).toEqual([]);
  expect(readEmfGradientVertices(view, -1, view.byteLength)).toEqual([]);
  view.setUint32(24, 0, true);
  expect(readEmfGradientVertices(view, 0, view.byteLength)).toEqual([]);
  view.setUint32(24, 80, true);
  expect(readEmfGradientVertices(view, 0, view.byteLength)).toEqual([]);
});

it("paints a horizontal or vertical quad and leaves strips and flat fills alone", () => {
  const horizontal = emfQuadGradient([
    vertex(0, 59, "#36a8e1"),
    vertex(2256, 59, "#fefefe"),
    vertex(0, 244, "#36a8e1"),
    vertex(2256, 244, "#fefefe"),
  ]);
  expect(horizontal).toMatchObject({ axis: "x", from: "#36a8e1", to: "#fefefe", x0: 0, x1: 2256 });

  const vertical = emfQuadGradient([
    vertex(10, 20, "#112233"),
    vertex(40, 20, "#112233"),
    vertex(10, 80, "#445566"),
    vertex(40, 80, "#445566"),
  ]);
  expect(vertical).toMatchObject({ axis: "y", from: "#112233", to: "#445566" });

  expect(
    emfQuadGradient([
      vertex(10, 20, "#6080c0"),
      vertex(40, 20, "#6080c0"),
      vertex(10, 21, "#6080c0"),
      vertex(40, 21, "#6080c0"),
    ]),
  ).toBeUndefined();
  expect(
    emfQuadGradient([
      vertex(0, 10, "#f48950"),
      vertex(40, 10, "#f48950"),
      vertex(0, 40, "#f48950"),
      vertex(40, 40, "#f48950"),
    ]),
  ).toBeUndefined();
  expect(
    emfQuadGradient([
      vertex(0, 10, "#111111"),
      vertex(40, 10, "#222222"),
      vertex(0, 40, "#333333"),
      vertex(40, 40, "#444444"),
    ]),
  ).toBeUndefined();
  expect(emfQuadGradient([vertex(0, 0, "#000000"), vertex(1, 1, "#ffffff")])).toBeUndefined();
  expect(
    emfQuadGradient([
      vertex(0, 10, "#111111"),
      vertex(40, 10, "#222222"),
      vertex(0, 40, "#111111"),
      vertex(0.4, 40, "#111111"),
    ]),
  ).toBeUndefined();
  expect(
    emfQuadGradient([
      vertex(0, 10, "#111111"),
      vertex(10, 10, "#222222"),
      vertex(20, 10, "#333333"),
      vertex(0, 40, "#111111"),
    ]),
  ).toBeUndefined();
  expect(
    emfQuadGradient([
      vertex(0, 10, "#111111"),
      vertex(0, 10, "#222222"),
      vertex(40, 10, "#333333"),
      vertex(0, 40, "#111111"),
      vertex(40, 40, "#333333"),
    ]),
  ).toBeUndefined();
  expect(
    emfQuadGradient([
      vertex(Number.NaN, 10, "#111111"),
      vertex(0, 10, "#111111"),
      vertex(40, 10, "#222222"),
      vertex(0, 40, "#111111"),
      vertex(40, 40, "#222222"),
    ]),
  ).toMatchObject({ axis: "x" });
});
