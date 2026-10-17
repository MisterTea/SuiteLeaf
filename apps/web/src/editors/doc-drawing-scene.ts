/** A saved Excalidraw scene. The picture in the document is a PNG of this scene. */
export type StoredDrawing = {
  elements: unknown[];
  appState: { viewBackgroundColor: string };
  files: Record<string, unknown>;
};

const SCENE_LIMIT = 1_500_000;

type SceneElement = { isDeleted?: boolean };

/**
 * Keep the shapes, the background, and any pictures placed on the canvas.
 * A scene that would dwarf the document is omitted; the PNG is still inserted.
 */
export function drawingRecord(scene: {
  elements: readonly SceneElement[];
  appState?: { viewBackgroundColor?: string };
  files?: Record<string, unknown> | null;
}): string | null {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  if (!elements.length) return null;
  const json = JSON.stringify({
    elements,
    appState: {
      viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff",
    },
    files: scene.files ?? {},
  } satisfies StoredDrawing);
  return json.length <= SCENE_LIMIT ? json : null;
}

export function readDrawing(value: unknown): StoredDrawing | null {
  if (typeof value !== "string" || !value || value.length > SCENE_LIMIT) return null;
  try {
    const parsed = JSON.parse(value) as StoredDrawing;
    if (!parsed || !Array.isArray(parsed.elements)) return null;
    return {
      elements: parsed.elements,
      appState: {
        viewBackgroundColor:
          typeof parsed.appState?.viewBackgroundColor === "string"
            ? parsed.appState.viewBackgroundColor
            : "#ffffff",
      },
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch {
    return null;
  }
}
