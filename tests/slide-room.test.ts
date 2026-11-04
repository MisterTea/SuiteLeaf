import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import {
  deckWithRemoteMaster,
  deckWithRemoteOrder,
  deckWithRemoteSlides,
  mirrorSlides,
  removedSlideIds,
  watchRemoteMaster,
  slideId,
  watchRemoteSlideOrder,
  watchRemoteSlides,
} from "../apps/web/src/collab/slide-room";

const deck = {
  slideOrder: ["s1"],
  slides: { s1: { id: "s1", title: "Beds" } },
};

describe("shared slides", () => {
  it("shows a slide from the other person and keeps the order", () => {
    expect(slideId("secret-value\nslide")).toBeNull();
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const seen: string[] = [];
    const orders: string[][] = [];
    const stopSlides = watchRemoteSlides(remote, (changes) => {
      seen.push(changes.map((change) => (change.slide as { title?: string } | null)?.title ?? change.id).join(","));
    });
    const stopOrder = watchRemoteSlideOrder(remote, (order) => orders.push(order));
    mirrorSlides(local, {
      slideOrder: ["s1", "s2"],
      slides: {
        s1: { id: "s1", title: "Beds" },
        s2: { id: "s2", title: "North" },
      },
    }, { added: ["s2"], edited: ["s1"], removed: [] });
    expect(JSON.parse(remote.getMap("slides").get("s2")!).title).toBe("North");
    expect(JSON.parse(remote.getMap("slideOrder").get("order")!)).toEqual(["s1", "s2"]);
    const withSlide = deckWithRemoteSlides(deck, [{ id: "s2", slide: { id: "s2", title: "North" } }]);
    expect(withSlide.slideOrder).toEqual(["s1", "s2"]);
    const ordered = deckWithRemoteOrder(withSlide, ["s2", "s1"]);
    expect(ordered.slideOrder).toEqual(["s2", "s1"]);
    mirrorSlides(local, {
      slideOrder: ["s1"],
      slides: { s1: { id: "s1", title: "Beds" } },
    }, { added: ["secret-value\nslide"], removed: ["s2"], edited: [] });
    expect(remote.getMap("slides").has("s2")).toBe(false);
    expect(JSON.stringify([...remote.getMap("slides").keys()])).not.toContain("secret-value");
    local.getMap("slideElements").set("other", JSON.stringify({ id: "z", text: "no" }));
    local.getMap("slideElements").set("s1\u001fbad\nid", JSON.stringify({ text: "no" }));
    mirrorSlides(local, {
      slideOrder: ["s1", "s2"],
      slides: { s1: { id: "s1", title: "Beds", elements: [{ id: "a", text: "Beds" }] } },
    }, { edited: ["s1"] });
    stopSlides();
    stopOrder();
    mirrorSlides(local, { slideOrder: ["s1", "s3"], slides: { s3: { id: "s3", title: "Later" } } }, { added: ["s3"] });
    expect(seen.join(" ")).toContain("North");
    expect(orders.some((order) => order.join() === "s1,s2")).toBe(true);
    const gone = deckWithRemoteSlides(withSlide, [{ id: "s2", slide: null }, { id: "secret-value\nslide", slide: { title: "no" } }]);
    expect(gone.slides.s2).toBeUndefined();
    expect(JSON.stringify(gone)).not.toContain("secret-value");
    const loop: { self?: unknown } = {};
    loop.self = loop;
    mirrorSlides(local, { slideOrder: ["s1", "s1"], slides: { s1: loop } }, { edited: ["s1", 4] });
    mirrorSlides(local, { slideOrder: ["s1"], slides: { s1: { id: "s1", title: "Beds" } } }, { edited: ["s1"] });
    mirrorSlides(local, { slideOrder: ["s1"], slides: { s1: { id: "s1", title: "Beds" } } }, { edited: ["s1"] });
    expect(slideId("")).toBeNull();
    expect(slideId("n".repeat(81))).toBeNull();
    expect(slideId(4)).toBeNull();
    const solo = new Y.Doc();
    const quiet: unknown[] = [];
    const stopBadSlides = watchRemoteSlides(solo, (changes) => quiet.push(changes));
    const stopBadOrder = watchRemoteSlideOrder(solo, (order) => quiet.push(order));
    solo.getMap("slides").set("s1", "{");
    solo.getMap("slideOrder").set("order", "nope");
    solo.getMap("slideOrder").delete("order");
    solo.transact(() => solo.getMap("slides").set("s4", JSON.stringify({ title: "Quiet" })), "slide-local");
    stopBadSlides();
    stopBadOrder();
    expect(quiet).toEqual([[]]);
    const kept = deckWithRemoteOrder(
      { slideOrder: ["s1", "local"], slides: { s1: { id: "s1" }, local: { id: "local" } } },
      ["s1", "s1"],
    );
    expect(kept.slideOrder).toEqual(["s1", "local"]);
    const empty = new Y.Doc();
    mirrorSlides(empty, null, null);
    mirrorSlides(empty, { slides: {} }, { edited: ["missing"], added: "nope" });
    expect(empty.getMap("slides").size).toBe(0);
    mirrorSlides(local, {
      slideOrder: ["s1"],
      slides: { s1: { id: "s1", title: "Beds", elements: [{ id: "a", text: "Beds" }, { id: "a", text: "again" }] } },
    }, { edited: ["s1"] });
    mirrorSlides(remote, {
      slideOrder: ["s1"],
      slides: {
        s1: {
          id: "s1",
          title: "Beds",
          elements: [{ id: "a", text: "Beds" }, { id: "c", text: "North" }],
        },
      },
    }, { edited: ["s1"] });
    expect(JSON.parse(local.getMap("slideElements").get("s1\u001fc")!).text).toBe("North");
    local.getMap("slideElements").set("s1\u001fextra", JSON.stringify({ id: "extra", text: "Keep" }));
    mirrorSlides(local, {
      slideOrder: ["s1"],
      slides: { s1: { id: "s1", title: "Beds", elements: [{ id: "a", text: "West" }] } },
    }, { edited: ["s1"] });
    expect(JSON.parse(local.getMap("slideElements").get("s1\u001fa")!).text).toBe("West");
    expect(JSON.parse(local.getMap("slideElements").get("s1\u001fc")!).text).toBe("North");
    expect(JSON.parse(local.getMap("slideElements").get("s1\u001fextra")!).text).toBe("Keep");
    mirrorSlides(local, {
      slideOrder: ["s1"],
      slides: { s1: { id: "s1", title: "Beds", elements: [{ id: "a", text: "West" }] } },
    }, { edited: ["s1"], removedElements: [{ slide: "s1", id: "c" }, { slide: "secret-value\ns1", id: "c" }] });
    local.getMap("slides").set("s1", "{");
    mirrorSlides(local, { slideOrder: ["s1"], slides: {} }, { removedElements: [{ slide: "s1", id: "a" }] });
    local.getMap("slideElements").set("other", JSON.stringify({ id: "z", text: "no" }));
    local.getMap("slideElements").set("s1\u001fbad\nid", JSON.stringify({ text: "no" }));
    mirrorSlides(local, {
      slideOrder: ["s1"],
      slides: { s1: { id: "s1", title: "Beds", elements: [{ id: "a", text: "West" }] } },
    }, { edited: ["s1"] });
    expect(local.getMap("slides").get("s1")).not.toBe("{");
    expect(local.getMap("slideElements").has("s1\u001fc")).toBe(false);
    expect(JSON.parse(local.getMap("slideElements").get("s1\u001fextra")!).text).toBe("Keep");
    const shown = deckWithRemoteSlides(deck, [{
      id: "s1",
      slide: {
        id: "s1",
        title: "Beds",
        elements: [
          { id: "a", text: "West" },
          { id: "extra", text: "Keep" },
        ],
      },
    }]);
    expect((shown.slides.s1 as { elements: { text: string }[] }).elements.map((item) => item.text)).toEqual(["West", "Keep"]);
    const left = new Y.Doc();
    const right = new Y.Doc();
    connectDocs(left, right);
    const applied: { text?: string }[][] = [];
    const stopApplied = watchRemoteSlides(right, (changes) => {
      const slide = changes[0]?.slide as { elements?: { text?: string }[] } | null;
      applied.push(slide?.elements ?? []);
    });
    mirrorSlides(left, {
      slideOrder: ["box"],
      slides: {
        box: {
          id: "box",
          title: "Plot",
          elements: [{ id: "a", text: "West" }, { text: "no id" }, "label"],
        },
      },
    }, { added: ["box"] });
    left.getMap("slideElements").set("box\u001fextra", JSON.stringify({ id: "extra", text: "Keep" }));
    left.getMap("slideElements").set("box\u001fbad", "{");
    const round: { id: string; self?: unknown } = { id: "round" };
    round.self = round;
    mirrorSlides(left, {
      slideOrder: ["box"],
      slides: { box: { id: "box", title: "Plot", elements: [{ id: "a", text: "West" }, round] } },
    }, { edited: ["box"] });
    mirrorSlides(left, { slideOrder: [], slides: {} }, { removed: ["box"] });
    stopApplied();
    expect(applied.some((items) => items.some((item) => item.text === "Keep"))).toBe(true);
    expect(right.getMap("slideElements").has("box\u001fa")).toBe(false);
  });

  it("keeps speaker notes, a comment, a picture, and the master", () => {
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const masters: { color?: string }[] = [];
    const stop = watchRemoteMaster(remote, (master) => {
      if (master?.background) masters.push(master.background);
    });
    mirrorSlides(local, {
      slideOrder: ["s1"],
      master: {
        background: { color: "secret-value\n#112233" },
        elements: [{ id: "logo", type: "image", src: picture }],
      },
      slides: {
        s1: {
          id: "s1",
          title: "Beds",
          notes: "Water the beds",
          comments: [
            { id: "secret-value\nthread", elementId: "a", messages: [{ text: "no" }] },
            { id: "thread-1", elementId: "a", messages: [{ text: "Stake the beans" }] },
          ],
          elements: [{ id: "pic", type: "image", src: picture, alt: "North beds" }],
        },
      },
    }, { added: ["s1"] });
    const shell = JSON.parse(local.getMap("slides").get("s1")!) as {
      notes?: string;
      comments?: { id: string }[];
    };
    expect(shell.notes).toBe("Water the beds");
    expect(shell.comments?.map((thread) => thread.id)).toEqual(["thread-1"]);
    expect(JSON.stringify(shell)).not.toContain("secret-value");
    expect(JSON.parse(local.getMap("slideElements").get("s1\u001fpic")!).src).toBe(picture);
    const master = JSON.parse(local.getMap("deck").get("master")!) as {
      background?: { color: string };
      elements: { src?: string }[];
    };
    expect(master.background).toBeUndefined();
    expect(master.elements[0]?.src).toBe(picture);
    expect(masters).toEqual([]);
    mirrorSlides(local, {
      slideOrder: ["s1"],
      master: { background: { color: "#112233" }, elements: [] },
      slides: { s1: { id: "s1", title: "Beds", notes: "Water the beds", elements: [] } },
    }, { edited: ["s1"] });
    expect(masters).toEqual([{ color: "#112233" }]);
    const withMaster = deckWithRemoteMaster({ master: undefined }, {
      background: { color: "#112233" },
      elements: [],
    });
    expect(withMaster.master?.background?.color).toBe("#112233");
    local.getMap("deck").delete("master");
    local.getMap("deck").set("master", "{");
    stop();
    mirrorSlides(local, {
      slideOrder: ["s1"],
      master: { background: { color: "#000000" }, elements: [] },
      slides: { s1: { id: "s1", elements: [] } },
    }, { edited: ["s1"] });
    expect(masters).toEqual([{ color: "#112233" }]);
  });

  it("does not put a deleted slide back when the order still names it", () => {
    const open = {
      slideOrder: ["s1", "s2"],
      slides: {
        s1: { id: "s1", title: "Beds" },
        s2: { id: "s2", title: "North" },
      },
    };
    const ordered = deckWithRemoteOrder(open, ["s2", "s1"], ["s2", "secret-value\nslide"]);
    expect(ordered.slideOrder).toEqual(["s1"]);
    expect(ordered.slides.s2).toBeUndefined();
    expect(JSON.stringify(ordered)).not.toContain("secret-value");
    const local = new Y.Doc();
    mirrorSlides(local, open, { added: ["s1", "s2"] });
    mirrorSlides(local, { slideOrder: ["s1"], slides: { s1: open.slides.s1 } }, { removed: ["s2"] });
    expect(removedSlideIds(local)).toEqual(["s2"]);
    const again = deckWithRemoteOrder(open, ["s2", "s1"], removedSlideIds(local));
    expect(again.slideOrder).toEqual(["s1"]);
    mirrorSlides(local, {
      slideOrder: ["s1", "s2"],
      slides: { s1: open.slides.s1, s2: open.slides.s2 },
    }, { added: ["s2"] });
    expect(removedSlideIds(local)).toEqual([]);
  });
});
