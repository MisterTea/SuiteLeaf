import type { RefObject } from "react";
import { Menu, MenuItem, SubMenu, TableMenuItems, type EditorActions } from "../ui";
import { EditorHelp } from "./workspace-help-menu";

export function DocMenus({
  actions,
  doAction,
}: {
  actions: RefObject<EditorActions | undefined>;
  doAction: (action: string) => Promise<void>;
}) {
  return (
    <>
      <Menu label="Edit">
        <MenuItem
          shortcut="Cmd+Z"
          onSelect={() => actions.current?.docActions?.undo()}
        >
          Undo
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Y"
          onSelect={() => actions.current?.docActions?.redo()}
        >
          Redo
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Shift+H"
          onSelect={() => actions.current?.docActions?.openFind()}
        >
          Find and replace
        </MenuItem>
        <MenuItem
          shortcut="Cmd+A"
          onSelect={() => actions.current?.docActions?.selectAll()}
        >
          Select all
        </MenuItem>
      </Menu>
      <Menu label="View">
        <MenuItem onSelect={() => void doAction("print")}>
          Print layout
        </MenuItem>
      </Menu>
      <Menu label="Insert">
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.insertImage()
          }
        >
          Image
        </MenuItem>
        <MenuItem
          synonyms={["text box", "insert text box", "textbox"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertTextBox()
          }
        >
          Text box
        </MenuItem>
        <SubMenu label="Shape">
          <MenuItem
            synonyms={["shape", "insert shape", "rectangle"]}
            focusesTarget
            onSelect={() =>
              actions.current?.docActions?.insertShape("rect")
            }
          >
            Rectangle
          </MenuItem>
          <MenuItem
            synonyms={["ellipse", "oval", "circle"]}
            focusesTarget
            onSelect={() =>
              actions.current?.docActions?.insertShape("ellipse")
            }
          >
            Ellipse
          </MenuItem>
        </SubMenu>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.insertTable()
          }
        >
          Table
        </MenuItem>
        <MenuItem
          synonyms={[
            "chart",
            "bar chart",
            "insert chart",
            "spreadsheet chart",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertChart?.()
          }
        >
          Insert chart
        </MenuItem>
        <MenuItem
          synonyms={[
            "equation",
            "math",
            "formula",
            "insert equation",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertEquation()
          }
        >
          Equation
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.insertHorizontalRule()
          }
        >
          Horizontal line
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Enter"
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertPageBreak()
          }
        >
          Page break
        </MenuItem>
        <MenuItem
          synonyms={["section", "section break", "new section"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertSectionBreak?.()
          }
        >
          Section break
        </MenuItem>
        <MenuItem
          synonyms={["drawing", "draw", "canvas"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertDrawing?.()
          }
        >
          Drawing
        </MenuItem>
        <SubMenu label="Table of contents">
          <MenuItem
            synonyms={[
              "table of contents",
              "toc",
              "contents",
              "insert table of contents",
            ]}
            focusesTarget
            onSelect={() =>
              actions.current?.docActions?.insertTableOfContents(
                true,
              )
            }
          >
            With page numbers
          </MenuItem>
          <MenuItem
            focusesTarget
            onSelect={() =>
              actions.current?.docActions?.insertTableOfContents(
                false,
              )
            }
          >
            With links
          </MenuItem>
        </SubMenu>
        <MenuItem
          synonyms={["figure list", "list of figures", "table list"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertFigureList?.("figure")
          }
        >
          Figure list
        </MenuItem>
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertFigureList?.("table")
          }
        >
          Table list
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Alt+F"
          synonyms={["footnote", "footnotes", "insert footnote"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertFootnote()
          }
        >
          Footnote
        </MenuItem>
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertEndnote()
          }
        >
          Endnote
        </MenuItem>
        <MenuItem
          shortcut="Cmd+K"
          availability={() => {
            const state =
              actions.current?.docActions?.linkState?.();
            return !state || state.ok ? true : state.reason;
          }}
          onSelect={() => actions.current?.docActions?.insertLink()}
        >
          Link
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Alt+M"
          synonyms={["comment", "comments", "document comments"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.insertComment?.()
          }
        >
          Comment
        </MenuItem>
      </Menu>
      <Menu label="Format">
        <MenuItem
          shortcut="Cmd+B"
          onSelect={() => actions.current?.docActions?.toggleBold()}
        >
          Bold
        </MenuItem>
        <MenuItem
          shortcut="Cmd+I"
          onSelect={() =>
            actions.current?.docActions?.toggleItalic()
          }
        >
          Italic
        </MenuItem>
        <MenuItem
          shortcut="Cmd+U"
          onSelect={() =>
            actions.current?.docActions?.toggleUnderline()
          }
        >
          Underline
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Shift+X"
          onSelect={() =>
            actions.current?.docActions?.toggleStrike()
          }
        >
          Strikethrough
        </MenuItem>
        <MenuItem
          shortcut="Cmd+."
          onSelect={() =>
            actions.current?.docActions?.toggleSuperscript()
          }
        >
          Superscript
        </MenuItem>
        <MenuItem
          shortcut="Cmd+,"
          onSelect={() =>
            actions.current?.docActions?.toggleSubscript()
          }
        >
          Subscript
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.align("left")
          }
        >
          Align left
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.align("center")
          }
        >
          Align center
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.align("right")
          }
        >
          Align right
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.align("justify")
          }
        >
          Justify
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.toggleBulletList()
          }
        >
          Bulleted list
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.toggleOrderedList()
          }
        >
          Numbered list
        </MenuItem>
        <MenuItem
          synonyms={["columns", "one column", "single column"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.setColumns(1)
          }
        >
          One column
        </MenuItem>
        <MenuItem
          synonyms={["columns", "two columns", "newspaper columns"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.setColumns(2)
          }
        >
          Two columns
        </MenuItem>
        <SubMenu label="Table">
          <TableMenuItems
            actions={() =>
              actions.current?.docActions?.tableActions() ?? []
            }
          />
        </SubMenu>
        <MenuItem
          synonyms={[
            "widow",
            "orphan",
            "prevent single lines",
            "don't leave one line",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.toggleWidowControl?.()
          }
        >
          Don't leave one line
        </MenuItem>
        <MenuItem
          shortcut="Cmd+\"
          onSelect={() =>
            actions.current?.docActions?.clearFormatting()
          }
        >
          Clear formatting
        </MenuItem>
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.updateNormalText()
          }
        >
          Update Normal text to match
        </MenuItem>
      </Menu>
      <Menu label="Tools">
        <MenuItem
          synonyms={[
            "mail merge",
            "merge letters",
            "merge spreadsheet",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openMailMerge?.()
          }
        >
          Merge from a spreadsheet
        </MenuItem>
        <MenuItem
          synonyms={["styles", "named style", "paragraph style"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openNamedStyles?.()
          }
        >
          Named styles
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Shift+C"
          synonyms={[
            "count",
            "word count",
            "wordcount",
            "count words",
            "words",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openWordCount()
          }
        >
          Word count
        </MenuItem>
        <MenuItem
          synonyms={["spelling", "spell check", "spellcheck"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openSpelling()
          }
        >
          Spelling
        </MenuItem>
        <MenuItem
          synonyms={[
            "grammar",
            "grammar check",
            "check grammar",
            "spelling and grammar",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openGrammar()
          }
        >
          Grammar
        </MenuItem>
        <MenuItem
          synonyms={["ignored grammar", "restore grammar"]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openIgnoredGrammar()
          }
        >
          Ignored grammar
        </MenuItem>
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openDictionary()
          }
        >
          Personal dictionary
        </MenuItem>
        <MenuItem
          synonyms={[
            "citations",
            "cite",
            "bibliography",
            "references",
            "sources",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.docActions?.openCitations()
          }
        >
          Citations
        </MenuItem>
        <MenuItem
          onSelect={() => actions.current?.docActions?.openFind()}
        >
          Find and replace
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.docActions?.openSuggestions?.()
          }
        >
          Review suggestions
        </MenuItem>
      </Menu>
      <EditorHelp />
    </>
  );
}
