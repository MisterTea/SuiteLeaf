import { extensionFor, type SuiteFile } from "@suiteleaf/core";
import { Menu, MenuItem, SubMenu } from "../ui";
import { drawingAction } from "../drawing-home";
import { drawingExports } from "../editors/drawing-format";
import { formsEnabled } from "../flags";
import { message } from "../error-message";
import type { WorkspaceState } from "./workspace-state";

export function FileMenu({
  ws,
  file: f,
  doAction,
  download,
  save,
  exportNative,
  makeCopy,
}: {
  ws: WorkspaceState;
  file: SuiteFile;
  doAction: (action: string) => Promise<void>;
  download: () => void;
  save: () => Promise<void>;
  exportNative: () => Promise<void>;
  makeCopy: () => Promise<void>;
}) {
  const {
    setError, setTemplateDraft, actionsReady, current, actions, setHistoryOpen,
    setHistoryPreview, setDriveDialog, cluster,
  } = ws;
  return (
    <Menu label="File">
      <SubMenu label="New">
        <MenuItem onSelect={() => void doAction("new-doc")}>
          Document
        </MenuItem>
        <MenuItem onSelect={() => void doAction("new-sheet")}>
          Spreadsheet
        </MenuItem>
        <MenuItem onSelect={() => void doAction("new-slide")}>
          Presentation
        </MenuItem>
        <MenuItem onSelect={() => void doAction("new-marp")}>
          MARP presentation
        </MenuItem>
        <MenuItem onSelect={() => void doAction(drawingAction("svg"))}>
          SVG drawing
        </MenuItem>
        <MenuItem onSelect={() => void doAction(drawingAction("mermaid"))}>
          Mermaid diagram
        </MenuItem>
        <MenuItem onSelect={() => void doAction(drawingAction("graphviz"))}>
          Graphviz graph
        </MenuItem>
        {formsEnabled ? (
        <MenuItem onSelect={() => void doAction("new-form")}>
          Form
        </MenuItem>
        ) : null}
        <MenuItem onSelect={() => void doAction("from-template")}>
          From template
        </MenuItem>
      </SubMenu>
      {cluster ? (
        <>
          <MenuItem onSelect={() => void doAction("open")}>
            Open…
          </MenuItem>
          <MenuItem onSelect={() => setDriveDialog("save")}>
            Save as…
          </MenuItem>
          <MenuItem disabled={!actionsReady} onSelect={download}>
            Download a copy
          </MenuItem>
        </>
      ) : (
        <MenuItem disabled={!actionsReady} onSelect={download}>
          {window.suiteleaf
            ? "Save As…"
            : `Download SuiteLeaf file (.${extensionFor(f.kind)})`}
        </MenuItem>
      )}
      <MenuItem onSelect={() => void doAction("save")}>
        Save now
      </MenuItem>
      <MenuItem
        shortcut="Cmd+Alt+Shift+H"
        onSelect={() => {
          setHistoryOpen((open) => !open);
          setHistoryPreview(null);
        }}
      >
        Version history
      </MenuItem>
      <MenuItem
        disabled={!actionsReady}
        focusesTarget
        onSelect={() => {
          void (async () => {
            await actions.current?.flush();
            await save();
            if (current.current)
              setTemplateDraft(structuredClone(current.current.file));
          })().catch((e) => setError(message(e)));
        }}
      >
        Save as template
      </MenuItem>
      {window.suiteleaf && !cluster ? (
        <MenuItem
          onSelect={() =>
            void exportNative().catch((e) => setError(message(e)))
          }
          disabled={!actionsReady}
        >
          Export native copy
        </MenuItem>
      ) : null}
      {(f.kind === "doc"
        ? ["docx", "pdf", "html", "txt"]
        : f.kind === "sheet"
          ? ["xlsx", "csv", "tsv"]
          : f.kind === "form"
            ? []
            : f.kind === "drawing"
              ? drawingExports(f.content.format)
              : f.kind === "slide" && f.content.marp
              ? ["md", ...(window.suiteleaf ? ["png"] : []), "txt", "html"]
              : f.kind === "slide"
                ? ["pptx", ...(window.suiteleaf ? ["png"] : []), "txt", "html"]
                : ["txt", "html"]
      ).map((format) => (
        <MenuItem
          key={format}
          disabled={!actionsReady}
          onSelect={() =>
            void actions.current
              ?.export(format)
              .catch((e) => setError(message(e)))
          }
        >
          {`Export ${format.toUpperCase()}`}
        </MenuItem>
      ))}
      <MenuItem
        onSelect={() =>
          void makeCopy().catch((e) => setError(message(e)))
        }
      >
        Make a copy
      </MenuItem>
      {f.kind === "doc" ? (
        <MenuItem
          disabled={!actionsReady}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openPageSetup()
          }
        >
          Page setup…
        </MenuItem>
      ) : null}
      {f.kind === "sheet" ? (
        <MenuItem
          synonyms={[
            "print settings",
            "repeat row",
            "repeat header",
            "repeating header",
            "print header",
          ]}
          onSelect={() =>
            actions.current?.sheetActions?.openPrintSettings?.()
          }
        >
          Print settings
        </MenuItem>
      ) : null}
      <MenuItem onSelect={() => void doAction("print")}>
        Print / Save as PDF
      </MenuItem>
    </Menu>
  );
}
