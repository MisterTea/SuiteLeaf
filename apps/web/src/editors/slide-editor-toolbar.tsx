import type { ChangeEvent, ReactNode } from "react";
import {
  ChevronDown,
  Circle,
  FileText,
  ImagePlus,
  ListChecks,
  MousePointer2,
  Palette,
  Play,
  Plus,
  Printer,
  Redo2,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { Slide } from "@suiteleaf/core";
import { Menu, MenuItem, Tool } from "../ui";
import { MenuSearchPill } from "../command-palette";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideOrderActions } from "./slide-editor-commands";
import type { SlideElementActions } from "./slide-editor-elements";
import type { SlideExports } from "./slide-editor-exports";
import type { ShowControls } from "./slide-editor-show";

/** The editor's toolbar. `formatTools` is the part that follows the selection. */
export function SlidesToolbar({
  state,
  readOnly,
  activeSlide,
  currentSlideIndex,
  formatTools,
  undo,
  redo,
  addSlide,
  alignSelected,
  distributeSelected,
  toggleLock,
  orderSelected,
  groupSelected,
  ungroupSelected,
  selectElement,
  addTextBox,
  addShape,
  handleImageUpload,
  handleMediaUpload,
  printSlides,
  beginShow,
}: Pick<DeckHistoryApi, "undo" | "redo"> &
  Pick<SlideOrderActions, "addSlide"> &
  Pick<
    SlideElementActions,
    | "alignSelected"
    | "distributeSelected"
    | "toggleLock"
    | "orderSelected"
    | "groupSelected"
    | "ungroupSelected"
    | "selectElement"
    | "addTextBox"
    | "addShape"
    | "handleImageUpload"
  > &
  Pick<SlideExports, "printSlides"> &
  Pick<ShowControls, "beginShow"> & {
    state: SlidesEditorState;
    readOnly: boolean;
    activeSlide: Slide;
    currentSlideIndex: number;
    formatTools: ReactNode;
    handleMediaUpload: (kind: "audio" | "video") => (e: ChangeEvent<HTMLInputElement>) => void;
  }) {
  const {
    deck, panel, setPanel, accessOpen, setAccessOpen, selectedElementId, marpOpen, setMarpOpen,
    historyMarks, imageInputRef, audioInputRef, videoInputRef,
  } = state;
  return (
    <div
      className="slides-toolbar"
      role="toolbar"
      aria-label="Slides toolbar"
    >
      <fieldset className="toolbar-edits" disabled={readOnly}>
      <div className="tool-group">
        <MenuSearchPill />
        <button
          type="button"
          className="menu-trigger theme-toggle"
          aria-pressed={panel === "theme"}
          onClick={() =>
            setPanel((open) => (open === "theme" ? null : "theme"))
          }
        >
          <Palette size={16} className="narrow-only-icon" aria-hidden="true" />
          <span className="tool-words">Theme</span>
        </button>
        <button
          type="button"
          className="menu-trigger theme-toggle"
          aria-pressed={panel === "language"}
          onClick={() => setPanel((open) => (open === "language" ? null : "language"))}
        >
          <span className="tool-words">Language</span>
        </button>
        <button
          type="button"
          className="menu-trigger theme-toggle"
          aria-pressed={accessOpen}
          onClick={() => setAccessOpen((open) => !open)}
        >
          <ListChecks size={16} className="narrow-only-icon" aria-hidden="true" />
          <span className="tool-words">Accessibility</span>
        </button>
        <Menu
          label="Align"
          trigger={<span className="tool-words">Align</span>}
        >
          <MenuItem onSelect={() => alignSelected("left")}>Align left</MenuItem>
          <MenuItem onSelect={() => alignSelected("center")}>Align center</MenuItem>
          <MenuItem onSelect={() => alignSelected("right")}>Align right</MenuItem>
          <MenuItem onSelect={() => alignSelected("top")}>Align top</MenuItem>
          <MenuItem onSelect={() => alignSelected("middle")}>Align middle</MenuItem>
          <MenuItem onSelect={() => alignSelected("bottom")}>Align bottom</MenuItem>
          <MenuItem onSelect={() => distributeSelected("horizontal")}>Distribute horizontally</MenuItem>
          <MenuItem onSelect={() => distributeSelected("vertical")}>Distribute vertically</MenuItem>
          <MenuItem onSelect={toggleLock}>
            {activeSlide.elements.find((item) => item.id === selectedElementId)?.locked
              ? "Unlock"
              : "Lock"}
          </MenuItem>
          <MenuItem onSelect={() => orderSelected("forward")}>Bring forward</MenuItem>
          <MenuItem onSelect={() => orderSelected("backward")}>Send backward</MenuItem>
          <MenuItem onSelect={() => orderSelected("front")}>Bring to front</MenuItem>
          <MenuItem onSelect={() => orderSelected("back")}>Send to back</MenuItem>
          <MenuItem onSelect={() => setPanel((open) => (open === "geometry" ? null : "geometry"))}>
            Size and position
          </MenuItem>
          <MenuItem onSelect={groupSelected}>Group</MenuItem>
          <MenuItem onSelect={ungroupSelected}>Ungroup</MenuItem>
        </Menu>
        {deck.marp ? (
          <button
            type="button"
            className="menu-trigger theme-toggle"
            aria-label="Markdown"
            aria-pressed={marpOpen}
            title={marpOpen ? "Hide the markdown" : "Show the markdown beside the slide"}
            onClick={() => setMarpOpen((open) => !open)}
          >
            <FileText size={16} className="narrow-only-icon" aria-hidden="true" />
            <span className="tool-words">Markdown</span>
          </button>
        ) : null}
        <Menu
          label="+ New slide"
          trigger={
            <>
              <Plus size={16} className="narrow-only-icon" aria-hidden="true" />
              <span className="tool-words">+ New slide</span>
            </>
          }
        >
          {deck.marp ? (
            <>
              <MenuItem onSelect={() => addSlide("title-body")}>
                Single column
              </MenuItem>
              <MenuItem onSelect={() => addSlide("two-column")}>
                Two columns
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem onSelect={() => addSlide("title-body")}>
                Title & body
              </MenuItem>
              <MenuItem onSelect={() => addSlide("title")}>Title slide</MenuItem>
              <MenuItem onSelect={() => addSlide("two-column")}>
                Two columns
              </MenuItem>
              <MenuItem onSelect={() => addSlide("section")}>
                Section header
              </MenuItem>
              <MenuItem onSelect={() => addSlide("blank")}>Blank slide</MenuItem>
            </>
          )}
        </Menu>

        <Tool
          label="Undo (Cmd+Z)"
          onClick={undo}
          disabled={!historyMarks.undo || readOnly}
        >
          <Undo2 size={16} />
        </Tool>
        <Tool
          label="Redo (Cmd+Y)"
          onClick={redo}
          disabled={!historyMarks.redo || readOnly}
        >
          <Redo2 size={16} />
        </Tool>
      </div>

      <div className="toolbar-divider" />

      <div className="tool-group">
        <Tool
          label="Select tool"
          active={!selectedElementId}
          onClick={() => selectElement(null)}
        >
          <MousePointer2 size={16} />
        </Tool>
        <Tool label="Insert text box" onClick={addTextBox}>
          <Type size={16} />
        </Tool>
        <Tool
          label="Insert image"
          onClick={() => imageInputRef.current?.click()}
        >
          <ImagePlus size={16} />
        </Tool>
        {deck.marp ? null : (
          <>
        <Tool label="Rectangle" onClick={() => addShape("roundRect")}>
          <Square size={16} />
        </Tool>
        <Tool label="Circle" onClick={() => addShape("ellipse")}>
          <Circle size={16} />
        </Tool>
          </>
        )}
        <input
          hidden
          type="file"
          ref={imageInputRef}
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          onChange={handleImageUpload}
        />
        <input
          hidden
          type="file"
          ref={audioInputRef}
          accept="audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/ogg,.wav,.mp3,.ogg"
          onChange={handleMediaUpload("audio")}
        />
        <input
          hidden
          type="file"
          ref={videoInputRef}
          accept="video/mp4,video/webm,.mp4,.webm"
          onChange={handleMediaUpload("video")}
        />
      </div>

      <div className="toolbar-divider" />

      {/* Dynamic Contextual Tools: Fill, Border, Typography or Slide background/layout */}
      {formatTools}
      </fieldset>

      <Tool label="Print (Cmd+P)" onClick={() => printSlides()}>
        <Printer size={16} />
      </Tool>

      {/* Google Slides styled Slideshow button */}
      <div className="tool-group right-tools">
        <div className="slideshow-split">
          <button
            type="button"
            className="slideshow-btn"
            onClick={() => beginShow(currentSlideIndex)}
            title="Present from current slide (Cmd+Enter)"
          >
            <Play size={14} fill="currentColor" />
            <span className="tool-words">Slideshow</span>
          </button>
          <Dropdown.Root>
            <Dropdown.Trigger
              className="slideshow-btn slideshow-menu-btn"
              aria-label="Slideshow options"
              title="Slideshow options"
            >
              <ChevronDown size={12} />
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content
                className="menu-content"
                sideOffset={4}
                align="end"
              >
                <MenuItem
                  shortcut="Cmd+Shift+Enter"
                  onSelect={() => beginShow(0)}
                >
                  Present from beginning
                </MenuItem>
                <MenuItem
                  shortcut="Cmd+Enter"
                  onSelect={() => beginShow(currentSlideIndex)}
                >
                  Present from current slide
                </MenuItem>
                <MenuItem
                  synonyms={["presenter view", "speaker view"]}
                  onSelect={() => beginShow(currentSlideIndex, true)}
                >
                  Presenter view
                </MenuItem>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </div>
      </div>
    </div>
  );
}
