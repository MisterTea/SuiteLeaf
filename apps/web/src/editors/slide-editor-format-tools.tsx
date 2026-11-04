import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  LayoutTemplate,
  List,
  Minus,
  PaintBucket,
  Paintbrush,
  Plus,
  Square,
  Trash2,
  Underline,
} from "lucide-react";
import type { Slide, SlideElement } from "@suiteleaf/core";
import { Menu, MenuItem, Tool } from "../ui";
import { FontControls } from "./font-controls";
import { applyBackground } from "./slide-layouts";
import { THEME_FONTS, handStyle } from "./slide-theme";
import { hasTextRuns } from "./slide-runs";
import { isMarpChrome, isMarpTitle } from "./slide-marp";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideDesign } from "./slide-editor-design";
import type { SlideElementActions, SlideUpdates } from "./slide-editor-elements";
import type { SlideTextFormat } from "./slide-editor-text";

/** Fill, border, and type for the selected object, or the slide's background and layout. */
export function SlideFormatTools({
  state,
  activeSlide,
  selectedElement,
  commit,
  updateElement,
  deleteSelectedElement,
  toggleBold,
  toggleItalic,
  toggleUnderline,
  applyAccent,
  setDeckBackground,
  applyLayoutToSlide,
}: Pick<DeckHistoryApi, "commit"> &
  Pick<SlideUpdates, "updateElement"> &
  Pick<SlideElementActions, "deleteSelectedElement"> &
  Pick<SlideTextFormat, "toggleBold" | "toggleItalic" | "toggleUnderline" | "applyAccent"> &
  Pick<SlideDesign, "setDeckBackground" | "applyLayoutToSlide"> & {
    state: SlidesEditorState;
    activeSlide: Slide;
    selectedElement: SlideElement | null;
  }) {
  const { deck, editingId, caretMarks, tableCell } = state;
  return selectedElement ? (
    <div className="tool-group">
      {deck.marp ? null : (
      <>
      {/* Fill color */}
      <Menu
        label="Fill"
        trigger={
          <>
            <PaintBucket size={16} className="narrow-only-icon" aria-hidden="true" />
            <span className="tool-words">Fill</span>
          </>
        }
      >
        {[
          { label: "Transparent", val: "transparent" },
          { label: "White", val: "#ffffff" },
          { label: "Soft grey", val: "#f1f3f4" },
          { label: "Slate", val: "#e2e8f0" },
          { label: "Light blue", val: "#d2e3fc" },
          { label: "Light green", val: "#ceead6" },
          { label: "Light yellow", val: "#feefc3" },
          { label: "Light red", val: "#fad2cf" },
          { label: "Blue", val: "#4285f4" },
          { label: "Green", val: "#34a853" },
          { label: "Yellow", val: "#fbbc04" },
          { label: "Red", val: "#ea4335" },
          { label: "Dark", val: "#202124" },
        ].map((c) => (
          <MenuItem
            key={c.val}
            onSelect={() =>
              updateElement(
                selectedElement.id,
                handStyle({ fill: c.val }),
              )
            }
          >
            <span
              className="menu-color-swatch"
              style={{ backgroundColor: c.val }}
            />
            {c.label}
          </MenuItem>
        ))}
      </Menu>

      {/* Border color */}
      <Menu
        label="Border"
        trigger={
          <>
            <Square size={16} className="narrow-only-icon" aria-hidden="true" />
            <span className="tool-words">Border</span>
          </>
        }
      >
        {[
          { label: "None", val: "transparent" },
          { label: "Grey", val: "#dadce0" },
          { label: "Dark", val: "#202124" },
          { label: "Google Blue", val: "#1a73e8" },
          { label: "Green", val: "#188038" },
          { label: "Red", val: "#d93025" },
        ].map((c) => (
          <MenuItem
            key={c.val}
            onSelect={() =>
              updateElement(
                selectedElement.id,
                handStyle({ stroke: c.val, strokeWidth: 2 }),
              )
            }
          >
            <span
              className="menu-color-swatch"
              style={{ backgroundColor: c.val }}
            />
            {c.label}
          </MenuItem>
        ))}
      </Menu>
      </>
      )}

      {selectedElement.type === "text" ? (
        <>
          {deck.marp ? null : (
          <FontControls>
          <select
            className="toolbar-select font-family-select"
            aria-label="Font family"
            value={selectedElement.fontFamily || "Arial"}
            onChange={(e) =>
              updateElement(
                selectedElement.id,
                handStyle({ fontFamily: e.target.value }),
              )
            }
          >
            {selectedElement.fontFamily &&
            ![...THEME_FONTS, "Roboto", "Helvetica"].includes(selectedElement.fontFamily) ? (
              <option value={selectedElement.fontFamily}>{selectedElement.fontFamily}</option>
            ) : null}
            {THEME_FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
            <option value="Roboto">Roboto</option>
            <option value="Helvetica">Helvetica</option>
          </select>

          {selectedElement.wordArt ? null : (
            <Tool
              label="Autofit"
              active={!!selectedElement.autofit}
              onClick={() =>
                updateElement(selectedElement.id, {
                  autofit: !selectedElement.autofit,
                })
              }
            >
              Autofit
            </Tool>
          )}

          <div className="font-size-stepper">
            <button
              type="button"
              className="stepper-btn"
              title="Decrease font size"
              aria-label="Decrease font size"
              onClick={() =>
                updateElement(selectedElement.id, {
                  fontSize: Math.max(
                    6,
                    (selectedElement.fontSize || 20) - 1,
                  ),
                })
              }
            >
              <Minus size={12} />
            </button>
            <input
              className="font-size-input"
              aria-label="Font size"
              value={selectedElement.fontSize || 20}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val > 0)
                  updateElement(
                    selectedElement.id,
                    { fontSize: val },
                    { coalesce: `size:${selectedElement.id}` },
                  );
              }}
            />
            <button
              type="button"
              className="stepper-btn"
              title="Increase font size"
              aria-label="Increase font size"
              onClick={() =>
                updateElement(selectedElement.id, {
                  fontSize: Math.min(
                    96,
                    (selectedElement.fontSize || 20) + 1,
                  ),
                })
              }
            >
              <Plus size={12} />
            </button>
          </div>
          </FontControls>
          )}

          <Tool
            label="Bold"
            active={
              editingId === selectedElement.id && caretMarks?.id === selectedElement.id
                ? caretMarks.bold
                : hasTextRuns(selectedElement)
                  ? !!selectedElement.runs?.every((run) => run.bold)
                  : !!selectedElement.bold
            }
            onClick={toggleBold}
          >
            <Bold size={16} />
          </Tool>
          <Tool
            label="Italic"
            active={
              editingId === selectedElement.id && caretMarks?.id === selectedElement.id
                ? caretMarks.italic
                : hasTextRuns(selectedElement)
                  ? !!selectedElement.runs?.every((run) => run.italic)
                  : !!selectedElement.italic
            }
            onClick={toggleItalic}
          >
            <Italic size={16} />
          </Tool>
          <Tool
            label="Underline"
            active={
              editingId === selectedElement.id && caretMarks?.id === selectedElement.id
                ? caretMarks.underline
                : hasTextRuns(selectedElement)
                  ? !!selectedElement.runs?.every((run) => run.underline)
                  : !!selectedElement.underline
            }
            onClick={toggleUnderline}
          >
            <Underline size={16} />
          </Tool>
          <Tool
            label="Accent colour for the selection"
            active={
              editingId === selectedElement.id &&
              caretMarks?.id === selectedElement.id &&
              caretMarks.color === (deck.theme?.accent ?? "").toLowerCase()
            }
            onClick={applyAccent}
          >
            <span className="text-color-tool">
              <span className="text-color-a">A</span>
              <span
                className="text-color-bar"
                style={{ background: deck.theme?.accent ?? "#188038" }}
              />
            </span>
          </Tool>
          {deck.marp ? null : (
          <>
          <Tool
            label="Align left"
            active={selectedElement.align === "left"}
            onClick={() =>
              updateElement(selectedElement.id, { align: "left" })
            }
          >
            <AlignLeft size={16} />
          </Tool>
          <Tool
            label="Align center"
            active={selectedElement.align === "center"}
            onClick={() =>
              updateElement(selectedElement.id, { align: "center" })
            }
          >
            <AlignCenter size={16} />
          </Tool>
          <Tool
            label="Align right"
            active={selectedElement.align === "right"}
            onClick={() =>
              updateElement(selectedElement.id, { align: "right" })
            }
          >
            <AlignRight size={16} />
          </Tool>
          <Tool
            label="Bullet list"
            active={!!selectedElement.bullet}
            onClick={() =>
              updateElement(selectedElement.id, {
                bullet: !selectedElement.bullet,
              })
            }
          >
            <List size={16} />
          </Tool>
          </>
          )}
        </>
      ) : selectedElement.type === "table" && tableCell?.id === selectedElement.id ? (
        <>
          <Tool
            label="Bold"
            active={!!selectedElement.cellMarks?.[tableCell.row]?.[tableCell.col]?.bold}
            onClick={toggleBold}
          >
            <Bold size={16} />
          </Tool>
          <Tool
            label="Italic"
            active={!!selectedElement.cellMarks?.[tableCell.row]?.[tableCell.col]?.italic}
            onClick={toggleItalic}
          >
            <Italic size={16} />
          </Tool>
        </>
      ) : null}

      {deck.marp && (isMarpTitle(selectedElement) || isMarpChrome(selectedElement)) ? null : (
      <Tool label="Delete element" onClick={deleteSelectedElement}>
        <Trash2 size={16} />
      </Tool>
      )}
    </div>
  ) : (
    <div className="tool-group">
      <Menu
        label="Background"
        trigger={
          <>
            <Paintbrush size={16} className="narrow-only-icon" aria-hidden="true" />
            <span className="tool-words">Background</span>
          </>
        }
      >
        {[
          { label: "White", val: "#ffffff" },
          { label: "Soft light", val: "#f8fafc" },
          { label: "Warm sand", val: "#fef3c7" },
          { label: "Sage green", val: "#e2ece9" },
          { label: "Dark slate", val: "#0f172a" },
          { label: "Deep navy", val: "#1e293b" },
        ].map((color) => (
          <MenuItem
            key={color.val}
            onSelect={() =>
              commit({
                ...deck,
                slides: {
                  ...deck.slides,
                  ...applyBackground(
                    { [activeSlide.id]: activeSlide },
                    color.val,
                  ),
                },
              })
            }
          >
            <span
              className="menu-color-swatch"
              style={{ backgroundColor: color.val }}
            />
            {color.label}
          </MenuItem>
        ))}
        <MenuItem
          onSelect={() =>
            setDeckBackground(
              activeSlide?.background?.color || "#ffffff",
              false,
            )
          }
        >
          Apply to all slides
        </MenuItem>
      </Menu>

      {deck.marp ? null : (
      <Menu
        label="Layout"
        trigger={
          <>
            <LayoutTemplate size={16} className="narrow-only-icon" aria-hidden="true" />
            <span className="tool-words">Layout</span>
          </>
        }
      >
        {(
          [
            ["title", "Title slide"],
            ["title-body", "Title & body"],
            ["two-column", "Two columns"],
            ["section", "Section header"],
            ["blank", "Blank slide"],
          ] as const
        ).map(([layout, label]) => (
          <MenuItem
            key={layout}
            onSelect={() => applyLayoutToSlide(layout)}
          >
            {label}
          </MenuItem>
        ))}
      </Menu>
      )}

    </div>
  );
}
