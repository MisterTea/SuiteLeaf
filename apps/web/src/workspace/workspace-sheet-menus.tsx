import type { RefObject } from "react";
import { Menu, MenuItem, SubMenu, type EditorActions } from "../ui";
import { FunctionMenu } from "../editors/function-help-ui";
import { SheetViewMenu } from "../editors/SheetViewMenu";
import { FilterViewChoices } from "../editors/sheet-filter-view";
import { ChartPivotMenu } from "../editors/chart-pivot-menu";
import { sheetTextRotation } from "../sheet-text-rotation";
import { getSession } from "../node-client";
import type { ResolvedMode } from "../mode";
import { EditorHelp } from "./workspace-help-menu";

/** Menu content mounts each time the menu opens, so this label reads current state. */
function LiveLabel({ text }: { text: () => string }) {
  return <>{text()}</>;
}
export function SheetMenus({
  actions,
  doAction,
  canEdit,
  mode,
}: {
  actions: RefObject<EditorActions | undefined>;
  doAction: (action: string) => Promise<void>;
  canEdit: boolean;
  mode: ResolvedMode["mode"];
}) {
  return (
    <>
      <Menu label="Edit">
        <MenuItem
          shortcut="Cmd+Z"
          onSelect={() => actions.current?.sheetActions?.undo()}
        >
          Undo
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Y"
          onSelect={() => actions.current?.sheetActions?.redo()}
        >
          Redo
        </MenuItem>
        <MenuItem
          shortcut="Cmd+X"
          onSelect={() => actions.current?.sheetActions?.cut()}
        >
          Cut
        </MenuItem>
        <MenuItem
          shortcut="Cmd+C"
          onSelect={() => actions.current?.sheetActions?.copy()}
        >
          Copy
        </MenuItem>
        <MenuItem
          shortcut="Cmd+V"
          onSelect={() => actions.current?.sheetActions?.paste()}
        >
          Paste
        </MenuItem>
        <SubMenu label="Paste special">
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.pasteTranspose()
            }
          >
            Transpose
          </MenuItem>
        </SubMenu>
        <MenuItem
          shortcut="Delete"
          onSelect={() =>
            actions.current?.sheetActions?.deleteValues()
          }
        >
          Delete values
        </MenuItem>
      </Menu>
      <Menu label="View">
        <SheetViewMenu
          actions={actions}
          onPrint={() => void doAction("print")}
        />
      </Menu>
      <Menu label="Insert">
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertImage?.()
          }
        >
          Image
        </MenuItem>
        <MenuItem
          synonyms={[
            "page break",
            "page break above",
            "row break",
            "insert page break",
            "insert break",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.sheetActions?.insertPageBreak?.()
          }
        >
          Page break above
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertChart()
          }
        >
          Chart
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertPivot()
          }
        >
          Pivot table
        </MenuItem>
        <SubMenu label="Function">
          <MenuItem
            synonyms={[
              "function",
              "formula",
              "insert function",
              "sum",
            ]}
            onSelect={() =>
              actions.current?.sheetActions?.insertFunction?.("SUM")
            }
          >
            Insert function
          </MenuItem>
          <FunctionMenu
            onInsert={(name) =>
              actions.current?.sheetActions?.insertFunction?.(name)
            }
          />
        </SubMenu>
        <MenuItem
          shortcut="Cmd+K"
          focusesTarget
          onSelect={() =>
            actions.current?.sheetActions?.insertLink?.()
          }
        >
          Link
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertCheckbox?.()
          }
        >
          Checkbox
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertDropdown?.()
          }
        >
          Dropdown
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertComment?.()
          }
        >
          Cell comment
        </MenuItem>
        <MenuItem
          synonyms={[
            "note",
            "cell note",
            "add note",
            "insert note",
          ]}
          focusesTarget
          onSelect={() =>
            actions.current?.sheetActions?.insertNote?.()
          }
        >
          Note
        </MenuItem>
      </Menu>
      <Menu label="Format">
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.formatCurrency()
          }
        >
          Currency ($)
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.formatPercent()
          }
        >
          Percent (%)
        </MenuItem>
        <MenuItem
          shortcut="Cmd+B"
          onSelect={() =>
            actions.current?.sheetActions?.toggleBold()
          }
        >
          Bold
        </MenuItem>
        <MenuItem
          shortcut="Cmd+I"
          onSelect={() =>
            actions.current?.sheetActions?.toggleItalic()
          }
        >
          Italic
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Shift+X"
          onSelect={() =>
            actions.current?.sheetActions?.toggleStrike()
          }
        >
          Strikethrough
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.align("left")
          }
        >
          Align left
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.align("center")
          }
        >
          Align center
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.align("right")
          }
        >
          Align right
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.unmergeCells()
          }
        >
          Unmerge cells
        </MenuItem>
        <SubMenu label="Rotate text">
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.rotateText(
                sheetTextRotation.tiltCounterclockwise,
              )
            }
          >
            Tilt counterclockwise
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.rotateText(
                sheetTextRotation.tiltClockwise,
              )
            }
          >
            Tilt clockwise
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.rotateText(
                sheetTextRotation.up,
              )
            }
          >
            Rotate up
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.rotateText(
                sheetTextRotation.down,
              )
            }
          >
            Rotate down
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.rotateText(
                sheetTextRotation.vertical,
              )
            }
          >
            Vertical
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.rotateText(
                sheetTextRotation.none,
              )
            }
          >
            None
          </MenuItem>
        </SubMenu>
        <MenuItem
          shortcut="Cmd+\"
          onSelect={() =>
            actions.current?.sheetActions?.clearFormatting()
          }
        >
          Clear formatting
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.conditionalFormatting?.()
          }
        >
          Conditional formatting
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.alternatingColors()
          }
        >
          Alternating colors
        </MenuItem>
      </Menu>
      <Menu label="Data">
        {!canEdit ? (
          <SubMenu label="Filter views">
            <MenuItem
              onSelect={() =>
                actions.current?.sheetActions?.createFilterView?.()
              }
            >
              Create a filter view
            </MenuItem>
            <FilterViewChoices
              load={() =>
                actions.current?.sheetActions?.filterViewChoices?.() ??
                []
              }
              onPick={(value) =>
                actions.current?.sheetActions?.applyFilterView?.(
                  value,
                )
              }
            />
          </SubMenu>
        ) : null}
        <MenuItem
          searchLabel="Create a filter"
          disabled={!canEdit}
          onSelect={() =>
            actions.current?.sheetActions?.toggleFilter()
          }
        >
          <LiveLabel
            text={() =>
              actions.current?.sheetActions?.hasFilter?.()
                ? "Remove filter"
                : "Create a filter"
            }
          />
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.insertPivot()
          }
        >
          Pivot table
        </MenuItem>
        <SubMenu label="Charts & pivots">
          <ChartPivotMenu
            load={() =>
              actions.current?.sheetActions?.analyses?.() ?? {
                charts: [],
                pivots: [],
              }
            }
            onEdit={(kind, id) =>
              actions.current?.sheetActions?.editAnalysis?.(kind, id)
            }
            onDeleteChart={(id) =>
              actions.current?.sheetActions?.deleteChart?.(id)
            }
            onRefresh={(id) =>
              actions.current?.sheetActions?.refreshPivot?.(id)
            }
            onCopy={(id) =>
              actions.current?.sheetActions?.copyPivot?.(id)
            }
          />
        </SubMenu>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.sortRange?.()
          }
        >
          Sort range
        </MenuItem>
        <MenuItem
          focusesTarget
          synonyms={[
            "named range",
            "define name",
            "name a range",
            "defined name",
          ]}
          onSelect={() =>
            actions.current?.sheetActions?.namedRanges?.()
          }
        >
          Named ranges
        </MenuItem>
        <MenuItem
          synonyms={["group", "outline", "collapse rows"]}
          onSelect={() =>
            actions.current?.sheetActions?.groupRows?.()
          }
        >
          Group rows
        </MenuItem>
        <MenuItem
          synonyms={[
            "group columns",
            "column group",
            "outline columns",
            "collapse columns",
          ]}
          onSelect={() =>
            actions.current?.sheetActions?.groupColumns?.()
          }
        >
          Group columns
        </MenuItem>
        <SubMenu label="Data cleanup">
          <MenuItem
            onSelect={() =>
              actions.current?.sheetActions?.trimWhitespace?.()
            }
          >
            Trim whitespace
          </MenuItem>
          <MenuItem
            synonyms={[
              "remove duplicates",
              "dedupe",
              "duplicates",
              "unique",
            ]}
            focusesTarget
            onSelect={() =>
              actions.current?.sheetActions?.removeDuplicates?.()
            }
          >
            Remove duplicates
          </MenuItem>
        </SubMenu>
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.sheetActions?.splitTextToColumns?.()
          }
        >
          Split text to columns
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.dataValidation?.()
          }
        >
          Data validation
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.sheetActions?.tabsProtection?.()
          }
        >
          Protect sheets and ranges
        </MenuItem>
      </Menu>
      <Menu label="Tools">
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.sheetActions?.openSpelling?.()
          }
        >
          Spelling
        </MenuItem>
        {mode.kind === "cluster" && getSession() ? null : (
          <MenuItem
            synonyms={[
              "comment name",
              "sign comments",
              "your name",
            ]}
            onSelect={() =>
              actions.current?.sheetActions?.commentName?.()
            }
          >
            Your name on comments…
          </MenuItem>
        )}
      </Menu>
      <EditorHelp />
    </>
  );
}
