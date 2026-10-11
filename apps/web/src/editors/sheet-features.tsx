import { useState, useImperativeHandle, type Ref } from "react";
import type { FUniver } from "@univerjs/core/facade";

import { Menu, MenuItem } from "../ui";

/** Local tab organization lives in worksheet metadata and travels with native files. */
export default function SheetFeatures({
  api,
  persist,
  onError,
  ref,
}: {
  ref?: Ref<{ openTabs: () => void }>;
  api: FUniver;
  persist: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rules, setRules] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      openTabs: () => {
        const sheet = api.getActiveWorkbook()?.getActiveSheet();
        if (!sheet) return;
        setSelected([sheet.getSheetId()]);
        setGroup(String(sheet.getCustomMetadata()?.suiteleafTabGroup ?? ""));
        setOpen(true);
        void sheet
          .getWorksheetPermission()
          .listRangeProtectionRules({ ignoreCollaborators: true })
          .then((rules) =>
            setRules(
              rules.map((r) => ({ id: r.id, name: r.options.name || r.id })),
            ),
          )
          .catch((e) => onError(String(e)));
      },
    }),
    [api, onError],
  );
  const workbook = api.getActiveWorkbook();
  if (!workbook) return null;
  const active = workbook.getActiveSheet();
  const sheets = workbook.getSheets();
  const groups = [
    ...new Set(
      sheets
        .map((s) => String(s.getCustomMetadata()?.suiteleafTabGroup ?? ""))
        .filter(Boolean),
    ),
  ];
  const run = async (work: () => unknown | Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      persist();
      setRevision((v) => v + 1);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const command = (id: string) =>
    void run(async () => {
      if (
        !(await api.executeCommand(
          id,
          id === "sheet.operation.open.conditional.formatting.panel"
            ? { value: 2 }
            : {},
        ))
      )
        throw new Error("Select a cell or range first.");
    });
  const loadRules = async () => {
    const rules = await active
      .getWorksheetPermission()
      .listRangeProtectionRules({ ignoreCollaborators: true });
    setRules(rules.map((r) => ({ id: r.id, name: r.options.name || r.id })));
  };
  return (
    <div className="sheet-features" data-revision={revision}>
      <Menu label="Sheet tools">
        <MenuItem
          onSelect={() =>
            command("data-validation.operation.open-validation-panel")
          }
        >
          Data validation
        </MenuItem>
        <MenuItem
          onSelect={() =>
            command("sheet.operation.open.conditional.formatting.panel")
          }
        >
          Conditional formatting
        </MenuItem>
        <MenuItem onSelect={() => command("sheet.operation.add-note-popup")}>
          Add or edit cell note
        </MenuItem>
        <MenuItem
          onSelect={() => command("sheet.operation.show-comment-modal")}
        >
          Add cell comment
        </MenuItem>
        <MenuItem
          onSelect={() => command("sheet.operation.toggle-comment-panel")}
        >
          Comments and replies
        </MenuItem>
        <MenuItem
          onSelect={() => {
            setSelected([active.getSheetId()]);
            setGroup(
              String(active.getCustomMetadata()?.suiteleafTabGroup ?? ""),
            );
            setOpen(true);
            void run(loadRules);
          }}
        >
          Tabs and protection…
        </MenuItem>
      </Menu>
      {groups.map((name) => (
        <details key={name} className="tab-group">
          <summary>{name}</summary>
          {sheets
            .filter((s) => s.getCustomMetadata()?.suiteleafTabGroup === name)
            .map((s) => (
              <button
                key={s.getSheetId()}
                onClick={() =>
                  void run(() => {
                    s.showSheet();
                    workbook.setActiveSheet(s);
                  })
                }
              >
                {s.getSheetName()}
              </button>
            ))}
        </details>
      ))}
      {open ? (
        <div className="gdocs-modal-overlay" onClick={() => setOpen(false)}>
          <section
            className="gdocs-dialog feature-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Tabs and protection"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <div className="dialog-header">
              <h2>Tabs and protection</h2>
              <button
                autoFocus
                aria-label="Close tabs and protection"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <p>Active sheet: {active.getSheetName()}</p>
              <fieldset disabled={busy}>
                <legend>Protect against accidental edits</legend>
                <button
                  onClick={() =>
                    void run(async () => {
                      const permission = active.getWorksheetPermission();
                      if (!permission.isProtected()) await permission.protect();
                      await permission.setReadOnly();
                      active.setCustomMetadata({
                        ...active.getCustomMetadata(),
                        suiteleafProtection: { sheet: true },
                      });
                    })
                  }
                >
                  Protect sheet
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      const permission = active.getWorksheetPermission();
                      if (permission.isProtected()) {
                        await permission.setEditable();
                        await permission.unprotect();
                      }
                      active.setCustomMetadata({
                        ...active.getCustomMetadata(),
                        suiteleafProtection: { sheet: false },
                      });
                    })
                  }
                >
                  Unprotect sheet
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      const range = workbook.getActiveRange();
                      if (!range) throw new Error("Select a range first.");
                      const created = await active
                        .getWorksheetPermission()
                        .protectRanges([
                          {
                            ranges: [range],
                            options: { name: range.getA1Notation() },
                          },
                        ]);
                      for (const rule of created)
                        await rule.setPoint(
                          api.Enum.RangePermissionPoint.Edit,
                          false,
                        );
                      await loadRules();
                    })
                  }
                >
                  Protect selected range
                </button>
                {rules.map((r) => (
                  <div key={r.id}>
                    {r.name}{" "}
                    <button
                      onClick={() =>
                        void run(async () => {
                          await active
                            .getWorksheetPermission()
                            .unprotectRules([r.id]);
                          await loadRules();
                        })
                      }
                    >
                      Remove protection
                    </button>
                  </div>
                ))}
              </fieldset>
              <fieldset disabled={busy}>
                <legend>Sheet tabs</legend>
                {sheets.map((s) => (
                  <div className="tab-settings-row" key={s.getSheetId()}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(s.getSheetId())}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, s.getSheetId()]
                              : selected.filter((id) => id !== s.getSheetId()),
                          )
                        }
                      />
                      {s.getSheetName()}
                      {s.isSheetHidden() ? " (hidden)" : ""}
                    </label>
                    <input
                      type="color"
                      aria-label={`Tab color for ${s.getSheetName()}`}
                      defaultValue={s.getTabColor() || "#ffffff"}
                      onChange={(e) =>
                        void run(() => s.setTabColor(e.target.value))
                      }
                    />
                    <button
                      onClick={() =>
                        void run(() => {
                          if (s.isSheetHidden()) s.showSheet();
                          else {
                            if (
                              sheets.filter((t) => !t.isSheetHidden()).length <=
                              1
                            )
                              throw new Error(
                                "Keep at least one sheet visible.",
                              );
                            s.hideSheet();
                          }
                        })
                      }
                    >
                      {s.isSheetHidden() ? "Show" : "Hide"}
                    </button>
                  </div>
                ))}
                <label>
                  Group name{" "}
                  <input
                    value={group}
                    maxLength={80}
                    onChange={(e) => setGroup(e.target.value)}
                    placeholder="e.g. Quarterly reports"
                  />
                </label>
                <button
                  disabled={!selected.length}
                  onClick={() =>
                    void run(() => {
                      for (const s of sheets.filter((s) =>
                        selected.includes(s.getSheetId()),
                      ))
                        s.setCustomMetadata({
                          ...s.getCustomMetadata(),
                          suiteleafTabGroup: group.trim(),
                        });
                    })
                  }
                >
                  {group.trim() ? "Assign group" : "Remove from group"}
                </button>
              </fieldset>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
