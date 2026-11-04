import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { undo as undoShared, redo as redoShared } from "y-prosemirror";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript as SuperscriptIcon,
  Subscript as SubscriptIcon,
  Undo2,
  Redo2,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ImagePlus,
  Link,
  Table,
  Search,
  Highlighter,
  Printer,
  Minus,
  Plus,
  RemoveFormatting,
  Indent,
  Outdent,
  FileCog,
  ListChecks,
  SeparatorHorizontal,
  EllipsisVertical,
  Pencil,
  Rows3,
} from "lucide-react";
import type { DocFile } from "@suiteleaf/core";
import { undoWaitingEdit } from "../collab/waiting-undo";
import { printDocument } from "../storage";
import { Tool } from "../ui";
import { MenuSearchPill } from "../command-palette";
import type { useToolbarOverflow } from "./toolbar-overflow";
import { FontControls } from "./font-controls";
import { uniqueSlug } from "../anchors";
import { SuggestionModeSwitch } from "./doc-suggestions-ui";
import { ColorTool } from "./color-picker";
import { LineSpacingControl } from "./doc-line-spacing-ui";
import { TabStopField } from "./doc-tab-stop-ui";

/** What the toolbar and outline read from the editor after each transaction. */
export function selectDocState(editor: Editor | null, transactionNumber: number) {
  const e = editor?.schema ? editor : null;
  return {
    revision: transactionNumber,
    bold: e?.isActive("bold"),
    widowControl: e?.isActive("paragraph", { widowControl: true }),
    keepNext:
      e?.isActive("paragraph", { keepNext: true }) ||
      e?.isActive("heading", { keepNext: true }),
    keepLines: e?.isActive("paragraph", { keepLines: true }),
    italic: e?.isActive("italic"),
    underline: e?.isActive("underline"),
    strike: e?.isActive("strike"),
    superscript: e?.isActive("superscript"),
    subscript: e?.isActive("subscript"),
    fontFamily: e?.getAttributes("textStyle").fontFamily ?? "Arial",
    fontSize: (() => {
      const raw = e?.getAttributes("textStyle").fontSize as
        string | undefined;
      if (raw)
        return String(parseFloat(raw) * (raw.endsWith("px") ? 0.75 : 1));
      return e?.isActive("heading")
        ? String(
            ({ 1: 20, 2: 16, 3: 14 } as Record<number, number>)[
              e.getAttributes("heading").level
            ] ?? 11,
          )
        : "11";
    })(),
    headings: (() => {
      const h: {
        text: string;
        pos: number;
        level: number;
        slug: string;
      }[] = [];
      const used = new Set<string>();
      e?.state.doc.descendants((n, p) => {
        if (n.type.name === "heading") {
          const text = n.textContent ?? "";
          const { slug } = uniqueSlug(text || "heading", used);
          h.push({ text, pos: p, level: n.attrs.level, slug });
        }
      });
      return h;
    })(),
  };
}

export type DocEditorState = ReturnType<typeof selectDocState>;

export function DocToolbar({
  editor,
  state,
  file,
  readOnly,
  sharedUndo,
  undoLocalEdit,
  redoLocalEdit,
  zoomLevel,
  setZoomLevel,
  docTools,
  moreDocTools,
  openPageSetup,
  textColor,
  setTextColor,
  highlightColor,
  setHighlightColor,
  openLinkDialog,
  imageInput,
  setDrawingScene,
  setDrawingOpen,
  setTableOpen,
  setFindOpen,
  setIndexOpen,
  setNotesOpen,
}: {
  editor: Editor;
  state: DocEditorState | null;
  file: DocFile;
  readOnly: boolean;
  sharedUndo: RefObject<boolean>;
  undoLocalEdit: RefObject<() => boolean>;
  redoLocalEdit: RefObject<() => boolean>;
  zoomLevel: string;
  setZoomLevel: Dispatch<SetStateAction<string>>;
  docTools: RefObject<HTMLFieldSetElement | null>;
  moreDocTools: ReturnType<typeof useToolbarOverflow>;
  openPageSetup: () => void;
  textColor: string;
  setTextColor: Dispatch<SetStateAction<string>>;
  highlightColor: string;
  setHighlightColor: Dispatch<SetStateAction<string>>;
  openLinkDialog: () => void;
  imageInput: RefObject<HTMLInputElement | null>;
  setDrawingScene: Dispatch<SetStateAction<string | null>>;
  setDrawingOpen: Dispatch<SetStateAction<boolean>>;
  setTableOpen: Dispatch<SetStateAction<boolean>>;
  setFindOpen: Dispatch<SetStateAction<boolean>>;
  setIndexOpen: Dispatch<SetStateAction<boolean>>;
  setNotesOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const changeFontSizeStep = (delta: number) => {
    if (!editor) return;
    const current = Number(state?.fontSize ?? 11) || 11;
    const next = Math.max(6, Math.min(96, current + delta));
    editor.chain().focus().setFontSize(`${next}pt`).run();
  };

  return (
    <div className="toolbar docs-toolbar" role="toolbar" aria-label="Document formatting">
      <MenuSearchPill />
      <fieldset className="toolbar-edits" disabled={readOnly}>
        <Tool
          label="Undo"
          onClick={() => {
            if (sharedUndo.current) {
              if (undoShared(editor.state) || undoLocalEdit.current()) undoWaitingEdit();
              return;
            }
            editor.commands.undo();
          }}
        >
          <Undo2 size={16} />
        </Tool>
        <Tool
          label="Redo"
          onClick={() => {
            if (!sharedUndo.current) editor.commands.redo();
            else if (!redoShared(editor.state)) redoLocalEdit.current();
          }}
        >
          <Redo2 size={16} />
        </Tool>
      </fieldset>
      <Tool label="Accessibility notes" onClick={() => setNotesOpen((open) => !open)}>
        <ListChecks size={16} />
      </Tool>
      <Tool label="Print" onClick={() => printDocument(file.title)}>
        <Printer size={16} />
      </Tool>

      <select
        className="toolbar-select zoom-select"
        aria-label="Zoom"
        value={zoomLevel}
        onChange={(e) => setZoomLevel(e.target.value)}
      >
        <option value="Fit">Fit</option>
        <option value="50%">50%</option>
        <option value="75%">75%</option>
        <option value="90%">90%</option>
        <option value="100%">100%</option>
        <option value="125%">125%</option>
        <option value="150%">150%</option>
        <option value="200%">200%</option>
      </select>

      <fieldset
        ref={docTools}
        className={`toolbar-edits toolbar-edits-rest docs-toolbar-tools${moreDocTools.overflowing ? " has-overflow" : ""}${moreDocTools.open ? " show-more" : ""}`}
        disabled={readOnly}
      >
      <Tool label="Page setup" onClick={openPageSetup}>
        <FileCog size={16} />
      </Tool>
      <Tool
        label="Page break"
        onClick={() => editor.chain().focus().setPageBreak().run()}
      >
        <SeparatorHorizontal size={16} />
      </Tool>
      <span className="divider" />

      <FontControls disabled={readOnly}>
      <select
        className="toolbar-select style-select"
        aria-label="Paragraph style"
        value={
          editor.isActive("heading")
            ? String(editor.getAttributes("heading").level)
            : "0"
        }
        onChange={(e) =>
          e.target.value === "0"
            ? editor.chain().focus().setParagraph().run()
            : editor
                .chain()
                .focus()
                .setHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                .run()
        }
      >
        <option value="0">Normal text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <LineSpacingControl editor={editor} />
      <TabStopField editor={editor} />

      <span className="divider" />

      <select
        className="toolbar-select font-family-select"
        aria-label="Font family"
        onChange={(e) =>
          editor.chain().focus().setFontFamily(e.target.value).run()
        }
        value={state?.fontFamily ?? "Arial"}
      >
        {state?.fontFamily &&
        !["Arial", "Georgia", "Times New Roman", "Courier New"].includes(
          state.fontFamily,
        ) ? (
          <option>{state.fontFamily}</option>
        ) : null}
        <option>Arial</option>
        <option>Georgia</option>
        <option>Times New Roman</option>
        <option>Courier New</option>
      </select>

      <span className="divider" />

      <div className="font-size-stepper">
        <button
          type="button"
          className="stepper-btn"
          aria-label="Decrease font size"
          title="Decrease font size"
          onClick={() => changeFontSizeStep(-1)}
        >
          <Minus size={13} />
        </button>
        <input
          className="font-size-input"
          aria-label="Font size"
          value={state?.fontSize ?? "11"}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (val > 0) editor.chain().focus().setFontSize(`${val}pt`).run();
          }}
        />
        <button
          type="button"
          className="stepper-btn"
          aria-label="Increase font size"
          title="Increase font size"
          onClick={() => changeFontSizeStep(1)}
        >
          <Plus size={13} />
        </button>
      </div>
      </FontControls>

      <span className="divider" />

      <Tool
        label="Bold"
        active={state?.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={16} />
      </Tool>
      <Tool
        label="Italic"
        active={state?.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={16} />
      </Tool>
      <Tool
        label="Underline"
        active={state?.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline size={16} />
      </Tool>
      <Tool
        label="Strikethrough"
        active={state?.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={16} />
      </Tool>
      <Tool
        label="Superscript"
        active={state?.superscript}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon size={16} />
      </Tool>
      <Tool
        label="Subscript"
        active={state?.subscript}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon size={16} />
      </Tool>

      <ColorTool
        label="Text color"
        value={textColor}
        onCommit={(color) => {
          setTextColor(color);
          editor.chain().focus().setColor(color).run();
        }}
      >
        <span className="text-color-letter">A</span>
      </ColorTool>

      <ColorTool
        label="Highlight color"
        value={highlightColor}
        onCommit={(color) => {
          setHighlightColor(color);
          editor.chain().focus().toggleHighlight({ color }).run();
        }}
      >
        <Highlighter size={15} />
      </ColorTool>

      <span className="divider" />

      <Tool
        label="Insert link"
        active={editor.isActive("link")}
        onClick={openLinkDialog}
      >
        <Link size={16} />
      </Tool>
      <Tool label="Insert image" onClick={() => imageInput.current?.click()}>
        <ImagePlus size={16} />
      </Tool>
      <Tool
        label="Drawing"
        onClick={() => {
          const saved = editor.isActive("image") ? editor.getAttributes("image").drawing : null;
          setDrawingScene(typeof saved === "string" ? saved : null);
          setDrawingOpen(true);
        }}
        disabled={readOnly}
      >
        <Pencil size={16} />
      </Tool>
      <Tool label="Insert table" onClick={() => setTableOpen(true)}>
        <Table size={16} />
      </Tool>

      <span className="divider" />

      <Tool
        label="Align left"
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft size={16} />
      </Tool>
      <Tool
        label="Align center"
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter size={16} />
      </Tool>
      <Tool
        label="Align right"
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight size={16} />
      </Tool>
      <Tool
        label="Justify"
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
      >
        <AlignJustify size={16} />
      </Tool>

      <span className="divider" />

      <Tool
        label="Bulleted list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={16} />
      </Tool>
      <Tool
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={16} />
      </Tool>
      <Tool
        label="Decrease indent"
        disabled={!editor.can().liftListItem("listItem")}
        onClick={() => editor.chain().focus().liftListItem("listItem").run()}
      >
        <Outdent size={16} />
      </Tool>
      <Tool
        label="Increase indent"
        disabled={!editor.can().sinkListItem("listItem")}
        onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
      >
        <Indent size={16} />
      </Tool>
      <Tool
        label="Clear formatting"
        onClick={() =>
          editor.chain().focus().unsetAllMarks().clearNodes().run()
        }
      >
        <RemoveFormatting size={16} />
      </Tool>
      <Tool label="Find and replace" onClick={() => setFindOpen((v) => !v)}>
        <Search size={16} />
      </Tool>
      <Tool
        label="Don't leave one line"
        active={state?.widowControl}
        disabled={readOnly}
        onClick={() => {
          const on = editor.isActive("paragraph", { widowControl: true });
          editor
            .chain()
            .focus()
            .updateAttributes("paragraph", { widowControl: on ? null : true })
            .run();
        }}
      >
        <Rows3 size={16} />
      </Tool>
      <Tool
        label="Keep with next"
        active={state?.keepNext}
        disabled={readOnly}
        onClick={() => {
          const type = editor.isActive("heading") ? "heading" : "paragraph";
          const on = editor.isActive(type, { keepNext: true });
          editor
            .chain()
            .focus()
            .updateAttributes(type, { keepNext: on ? null : true })
            .run();
        }}
      >
        <Rows3 size={16} />
      </Tool>
      <Tool
        label="Index entry"
        disabled={readOnly}
        onClick={() => setIndexOpen((open) => !open)}
      >
        <ListChecks size={16} />
      </Tool>
      <Tool
        label="Keep lines together"
        active={state?.keepLines}
        disabled={readOnly}
        onClick={() => {
          const on = editor.isActive("paragraph", { keepLines: true });
          editor
            .chain()
            .focus()
            .updateAttributes("paragraph", { keepLines: on ? null : true })
            .run();
        }}
      >
        <Rows3 size={16} />
      </Tool>
      <SuggestionModeSwitch />
      {moreDocTools.open ? (
        <span className="toolbar-break" aria-hidden="true" />
      ) : null}
      <button
        type="button"
        className="tool more-tools"
        title="More tools"
        aria-label="More tools"
        aria-expanded={moreDocTools.open}
        onClick={() => moreDocTools.setOpen(!moreDocTools.open)}
      >
        <EllipsisVertical size={16} />
      </button>
      </fieldset>
    </div>
  );
}
