import { describe, expect, it } from "vitest";
import { clampScrollPosition, mapScrollPosition } from "./merge-scroll-map";

describe("mapScrollPosition", () => {
  it("uses identity mapping when there are no hunk anchors", () => {
    expect(mapScrollPosition(140, [], [])).toBe(140);
  });

  it("keeps the first hunk offset before the first anchor", () => {
    expect(mapScrollPosition(100, [200], [180])).toBe(80);
  });

  it("interpolates between hunks with different panel heights", () => {
    expect(mapScrollPosition(200, [100, 300], [80, 380])).toBe(230);
  });

  it("keeps the final hunk offset after the last anchor", () => {
    expect(mapScrollPosition(450, [100, 300], [80, 380])).toBe(530);
  });

  it("maps back to the original position when source and target are reversed", () => {
    const sidePosition = mapScrollPosition(200, [100, 300], [80, 380]);

    expect(mapScrollPosition(sidePosition, [80, 380], [100, 300])).toBeCloseTo(200);
  });

  it("ignores unmatched trailing anchors", () => {
    expect(mapScrollPosition(100, [0, 200], [20])).toBe(120);
  });
});

describe("clampScrollPosition", () => {
  it("clamps positions to the scrollable viewport range", () => {
    expect(clampScrollPosition(-20, 1000, 300)).toBe(0);
    expect(clampScrollPosition(400, 1000, 300)).toBe(400);
    expect(clampScrollPosition(900, 1000, 300)).toBe(700);
  });

  it("returns zero when content is shorter than the viewport", () => {
    expect(clampScrollPosition(40, 200, 300)).toBe(0);
  });
});
