import * as Y from "yjs";

const UNDO_ORIGIN = "slide-undo";
const ELEMENT = "\u001f";

type Write = { map: "slideElements" | "slides"; key: string; json: string | null; previous: string | null };

type Stack = { undo: Write[][]; redo: Write[][] };

const stacks = new WeakMap<Y.Doc, Stack>();

function stackFor(doc: Y.Doc): Stack {
  const found = stacks.get(doc);
  if (found) return found;
  const created = { undo: [], redo: [] };
  stacks.set(doc, created);
  return created;
}

function changed(
  map: Write["map"],
  before: Map<string, string>,
  after: Map<string, string>,
): Write[] {
  const writes: Write[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(key) ?? null;
    const json = after.get(key) ?? null;
    if (previous !== json) writes.push({ map, key, json, previous });
  }
  return writes;
}

/** Remember a local slide edit so undo can take it back. */
export function noteSlideEdit(
  doc: Y.Doc,
  beforeElements: Map<string, string>,
  afterElements: Map<string, string>,
  beforeSlides: Map<string, string>,
  afterSlides: Map<string, string>,
): void {
  const writes = [
    ...changed("slideElements", beforeElements, afterElements),
    ...changed("slides", beforeSlides, afterSlides),
  ];
  if (!writes.length) return;
  const stack = stackFor(doc);
  stack.undo.push(writes);
  stack.redo = [];
}

export type SlideUndoResult = { conflicts: string[] };

function applyWrites(doc: Y.Doc, writes: { map: Write["map"]; key: string; json: string | null }[]): void {
  doc.transact(() => {
    for (const write of writes) {
      const map = doc.getMap<string>(write.map);
      if (write.json == null) map.delete(write.key);
      else map.set(write.key, write.json);
    }
  }, UNDO_ORIGIN);
}

function revert(doc: Y.Doc, groups: Write[][], other: Write[][]): SlideUndoResult | null {
  const writes = groups.pop();
  if (!writes) return null;
  const applied: Write[] = [];
  const conflicts: string[] = [];
  for (const write of writes) {
    const now = doc.getMap<string>(write.map).get(write.key) ?? null;
    if (now !== write.json) {
      conflicts.push(`${write.map}${ELEMENT}${write.key}`);
      continue;
    }
    applied.push(write);
  }
  if (applied.length) {
    applyWrites(
      doc,
      applied.map((write) => ({ map: write.map, key: write.key, json: write.previous })),
    );
    other.push(applied.map((write) => ({ ...write, json: write.previous, previous: write.json })));
  }
  return { conflicts };
}

/** Take back the newest local slide edit. An object someone else changed later is left alone. */
export function undoLocalSlide(doc: Y.Doc): SlideUndoResult | null {
  const stack = stackFor(doc);
  return revert(doc, stack.undo, stack.redo);
}

/** Put back the newest undone slide edit, unless that object has since changed. */
export function redoLocalSlide(doc: Y.Doc): SlideUndoResult | null {
  const stack = stackFor(doc);
  return revert(doc, stack.redo, stack.undo);
}

/** A conflict notice. Object text is not included. */
export function slideConflictText(keys: string[]): string {
  const labels = keys.map((key) => {
    const [map, id, element] = key.split(ELEMENT);
    if (map === "slideElements" && id && element) return `${id} ${element}`;
    if (map === "slides" && id) return id;
    return null;
  }).filter((label): label is string => !!label);
  if (labels.length === 1) return `${labels[0]} was changed by someone else and was left as it is.`;
  if (labels.length > 1) return `${labels.join(", ")} were changed by someone else and were left as they are.`;
  return "An object was changed by someone else and was left as it is.";
}
