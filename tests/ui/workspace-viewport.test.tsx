// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceViewport } from "../../apps/web/src/workspace/workspace-viewport";

function Surface({ visible = true }: { visible?: boolean }) {
  const ref = useWorkspaceViewport();
  return visible ? <div ref={ref} data-testid="surface" /> : null;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("tracks keyboard resizing and viewport panning, then removes listeners", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  const remove = vi.spyOn(viewport, "removeEventListener");
  vi.stubGlobal("visualViewport", viewport);
  const view = render(<Surface visible={false} />);
  view.rerender(<Surface />);
  const node = view.getByTestId("surface");
  expect(node.style.getPropertyValue("--workspace-visible-height")).toBe("844px");
  act(() => {
    viewport.height = 390;
    viewport.dispatchEvent(new Event("resize"));
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event("scroll"));
  });
  expect(node.style.getPropertyValue("--workspace-visible-height")).toBe("390px");
  expect(node.style.getPropertyValue("--workspace-visible-top")).toBe("120px");
  view.unmount();
  expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
});

it("falls back to CSS viewport sizing without the visual viewport API", () => {
  vi.stubGlobal("visualViewport", undefined);
  const view = render(<Surface />);
  expect(view.getByTestId("surface").style.length).toBe(0);
});
