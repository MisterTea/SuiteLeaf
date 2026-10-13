import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";
import {
  appHandlesShortcut,
  commandGroup,
  eventMatchesShortcut,
  extraShortcuts,
  formatShortcut,
  groupShortcuts,
  isMacPlatform,
  normalizeQuery,
  pendingReason,
  readRecentCommands,
  rememberCommand,
  searchCommands,
  synonymsFor,
  type CommandView,
  type KeyEvent,
} from "./commands";

export type CommandRegistration = {
  id: string;
  label: string;
  path: string[];
  shortcut?: string;
  synonyms?: string[];
  group?: string;
  pending?: boolean;
  availability?: () => true | string;
  run: () => void;
};

type CommandSnapshot = CommandView & {
  pending: boolean;
  run: () => void;
};

type Registry = {
  mount: (owner: symbol, read: () => CommandSnapshot) => () => void;
  list: () => CommandSnapshot[];
};

const CommandRegistry = createContext<Registry | null>(null);
const PaletteActions = createContext<{
  openSearch: () => void;
  openShortcuts: () => void;
} | null>(null);

export function useCommandPalette() {
  const palette = useContext(PaletteActions);
  if (!palette) throw new Error("Command palette is only available in an editor.");
  return palette;
}

export function useRegisterCommand(command: CommandRegistration | null) {
  const registry = useContext(CommandRegistry);
  const owner = useRef(Symbol("command"));
  const commandRef = useRef(command);
  commandRef.current = command;
  const id = command?.id ?? "";
  const label = command?.label ?? "";
  const shortcut = command?.shortcut ?? "";
  const pending = !!command?.pending;
  const pathKey = command?.path.join("/") ?? "";
  useEffect(() => {
    if (!registry || !id || !label) return;
    return registry.mount(owner.current, () => {
      const current = commandRef.current;
      if (!current)
        return {
          id,
          label,
          path: [],
          synonyms: [],
          pending: true,
          run: () => {},
        };
      const availability = current.availability?.();
      const disabledReason =
        typeof availability === "string"
          ? availability
          : current.pending
            ? pendingReason(current.label)
            : undefined;
      return {
        id: current.id,
        label: current.label,
        path: current.path,
        shortcut: current.shortcut,
        synonyms: synonymsFor(current.label, current.synonyms),
        group: commandGroup(current.path, current.label, current.group),
        pending: !!current.pending,
        disabledReason,
        run: () => current.run(),
      };
    });
  }, [registry, id, label, shortcut, pending, pathKey]);
}

export function MenuSearchPill() {
  const { openSearch } = useCommandPalette();
  return (
    <button
      type="button"
      className="menu-search-pill"
      title="Search the menus (Option+/)"
      onClick={openSearch}
    >
      <Search size={14} className="menu-search-icon" />
      <span>Menus</span>
    </button>
  );
}

function menuTriggers() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(".file-menu > .menu-trigger"),
  ];
}

function focusMenuTrigger(index: number) {
  const triggers = menuTriggers();
  if (!triggers.length) return;
  triggers[((index % triggers.length) + triggers.length) % triggers.length]?.focus();
}

/** Radix opens a menu on ArrowDown, not on a synthetic click. */
function openMenuTrigger(trigger: HTMLButtonElement) {
  trigger.focus();
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    // The comment box is contenteditable so a mention can be a chip. It is not
    // the document, so menu shortcuts (such as Cmd+Enter for a page break) stay out of it.
    (target instanceof HTMLElement && target.classList.contains("doc-mention-field"))
  );
}

export function CommandPalette({
  kind,
  children,
}: {
  kind: "doc" | "sheet" | "slide";
  children: ReactNode;
}) {
  const entries = useRef(new Map<symbol, () => CommandSnapshot>());
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<"search" | "shortcuts" | null>(null);
  const [query, setQuery] = useState("");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const shortcutInput = useRef<HTMLInputElement>(null);
  const mac = isMacPlatform();

  const registry = useMemo<Registry>(
    () => ({
      mount(owner, read) {
        entries.current.set(owner, read);
        setVersion((n) => n + 1);
        return () => {
          if (entries.current.get(owner) !== read) return;
          entries.current.delete(owner);
          setVersion((n) => n + 1);
        };
      },
      list() {
        const byId = new Map<string, CommandSnapshot>();
        for (const read of entries.current.values()) {
          const command = read();
          if (!command.label) continue;
          const existing = byId.get(command.id);
          if (existing && !existing.pending && command.pending) continue;
          byId.set(command.id, command);
        }
        return [...byId.values()];
      },
    }),
    [],
  );

  void version;
  const commands = registry.list();
  const results = searchCommands(commands, query, recent);
  const shortcutRows = useMemo(() => {
    const fromMenus = commands
      .filter((command) => command.shortcut && !command.pending)
      .map((command) => ({
        label: command.path.length
          ? `${command.path.join(" › ")} › ${command.label}`
          : command.label,
        shortcut: command.shortcut!,
        group: command.group || "Editing",
      }));
    const listed = new Set(fromMenus.map((row) => row.shortcut));
    const needle = normalizeQuery(shortcutQuery);
    return groupShortcuts([
      ...fromMenus,
      ...extraShortcuts(kind, mac).filter((row) => !listed.has(row.shortcut)),
    ]).map(
      ([group, rows]) =>
        [
          group,
          rows.filter((row) => {
            if (!needle) return true;
            const formatted = normalizeQuery(formatShortcut(row.shortcut, mac));
            return (
              normalizeQuery(row.label).includes(needle) ||
              formatted.includes(needle) ||
              normalizeQuery(row.shortcut).includes(needle)
            );
          }),
        ] as const,
    );
  }, [commands, kind, mac, shortcutQuery]);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const listRef = useRef(registry.list);
  listRef.current = () => registry.list();

  const openSearch = () => {
    setQuery("");
    setHighlight(0);
    setRecent(readRecentCommands());
    setMode("search");
  };
  const openShortcuts = () => {
    setShortcutQuery("");
    setMode("shortcuts");
  };
  const actions = useMemo(
    () => ({ openSearch, openShortcuts }),
    [],
  );

  const runCommand = (command: CommandView) => {
    if (command.disabledReason) return;
    const live = registry.list().find((item) => item.id === command.id);
    if (!live || live.disabledReason) return;
    setRecent(rememberCommand(command.id));
    setMode(null);
    setQuery("");
    window.setTimeout(() => live.run(), 0);
  };

  useEffect(() => {
    if (mode === "search") searchInput.current?.focus();
    if (mode === "shortcuts") shortcutInput.current?.focus();
  }, [mode]);

  // Commands such as Freeze become available as the editor finishes opening.
  useEffect(() => {
    if (mode !== "search") return;
    const timer = window.setInterval(() => setVersion((n) => n + 1), 400);
    return () => window.clearInterval(timer);
  }, [mode]);

  useEffect(() => setHighlight(0), [query, mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const keyEvent: KeyEvent = event;
      if (eventMatchesShortcut("Mod+/", keyEvent, mac)) {
        event.preventDefault();
        event.stopPropagation();
        setMode((current) => (current === "shortcuts" ? null : "shortcuts"));
        setShortcutQuery("");
        return;
      }
      if (eventMatchesShortcut("Alt+/", keyEvent, mac)) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setHighlight(0);
        setRecent(readRecentCommands());
        setMode((current) => (current === "search" ? null : "search"));
        return;
      }
      const inDocument =
        event.target instanceof Element &&
        !!event.target.closest(".document-content");
      // Ctrl+Alt+M focuses the menu bar, except in a document on keyboards
      // where that chord is also the comment shortcut. Commenting wins there.
      // F10 focuses the menu bar everywhere.
      if (
        eventMatchesShortcut("F10", keyEvent, mac) ||
        (eventMatchesShortcut("Ctrl+Alt+M", keyEvent, mac) &&
          (mac || !inDocument))
      ) {
        event.preventDefault();
        event.stopPropagation();
        setMode(null);
        focusMenuTrigger(0);
        return;
      }
      if (modeRef.current === "search") {
        const count = resultsRef.current.length;
        if (event.key === "Escape") {
          event.preventDefault();
          setMode(null);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setHighlight((current) => {
            if (!count) return 0;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            return (current + delta + count) % count;
          });
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          const command = resultsRef.current[highlightRef.current];
          if (!command || command.disabledReason) return;
          const live = listRef.current().find((item) => item.id === command.id);
          if (!live || live.disabledReason) return;
          setRecent(rememberCommand(command.id));
          setMode(null);
          setQuery("");
          live.run();
        }
        return;
      }
      if (modeRef.current === "shortcuts") {
        if (event.key === "Escape") {
          event.preventDefault();
          setMode(null);
        }
        return;
      }
      const triggers = menuTriggers();
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && triggers.includes(active)) {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          focusMenuTrigger(
            triggers.indexOf(active) + (event.key === "ArrowRight" ? 1 : -1),
          );
          return;
        }
      }
      const open = document.querySelector<HTMLButtonElement>(
        ".file-menu > .menu-trigger[data-state='open']",
      );
      if (open && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        const highlighted = document.querySelector(
          "[role='menuitem'][data-highlighted]",
        );
        const openMenus = document.querySelectorAll(
          ".menu-content:not(.menu-parked)",
        ).length;
        if (
          event.key === "ArrowRight" &&
          highlighted?.getAttribute("aria-haspopup") === "menu"
        )
          return;
        if (event.key === "ArrowLeft" && openMenus > 1) return;
        event.preventDefault();
        event.stopPropagation();
        const next =
          triggers[
            triggers.indexOf(open) + (event.key === "ArrowRight" ? 1 : -1)
          ];
        if (next) openMenuTrigger(next);
        return;
      }
      if (isTextField(event.target) || event.repeat) return;
      const command = listRef.current().find(
        (item) =>
          item.shortcut &&
          !item.disabledReason &&
          appHandlesShortcut(item.shortcut, kindRef.current, item.pending) &&
          eventMatchesShortcut(item.shortcut, keyEvent, mac),
      );
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      setRecent(rememberCommand(command.id));
      command.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mac]);

  const recentVisible =
    !query && results.some((command) => recent.includes(command.id));

  return (
    <CommandRegistry.Provider value={registry}>
      <PaletteActions.Provider value={actions}>
        {children}
        {mode ? (
          <div
            className="command-backdrop"
            onMouseDown={() => setMode(null)}
          />
        ) : null}
        {mode === "search" ? (
          <div
            className="command-search"
            role="dialog"
            aria-label="Search the menus"
          >
            <input
              ref={searchInput}
              aria-label="Search the menus"
              placeholder="Search the menus"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {recentVisible ? <p className="command-section">Recent</p> : null}
            {results.length ? (
              <ul role="listbox" aria-label="Commands">
                {results.map((command, index) => {
                  const showGap =
                    recentVisible &&
                    index > 0 &&
                    recent.includes(results[index - 1].id) &&
                    !recent.includes(command.id);
                  return (
                    <li key={command.id} className={showGap ? "command-gap" : undefined}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        aria-disabled={!!command.disabledReason}
                        className={`command-option${index === highlight ? " active" : ""}${command.disabledReason ? " disabled" : ""}`}
                        onMouseEnter={() => setHighlight(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          runCommand(command);
                        }}
                      >
                        <span className="command-path">
                          {[...command.path, command.label].join(" › ")}
                        </span>
                        {command.disabledReason ? (
                          <span className="command-reason">
                            {command.disabledReason}
                          </span>
                        ) : command.shortcut ? (
                          <span className="command-keys">
                            {formatShortcut(command.shortcut, mac)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="command-empty">No matching commands</p>
            )}
            <p className="command-hint">↑↓ to move · Enter to run · Esc to close</p>
          </div>
        ) : null}
        {mode === "shortcuts" ? (
          <div
            className="gdocs-dialog command-shortcuts"
            role="dialog"
            aria-label="Keyboard shortcuts"
          >
            <div className="dialog-header">
              <h2>Keyboard shortcuts</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close"
                onClick={() => setMode(null)}
              >
                <X size={18} />
              </button>
            </div>
            <input
              ref={shortcutInput}
              aria-label="Search shortcuts"
              placeholder="Search shortcuts"
              value={shortcutQuery}
              onChange={(event) => setShortcutQuery(event.target.value)}
            />
            <div className="command-shortcut-list">
              {shortcutRows.every(([, rows]) => !rows.length) ? (
                <p className="command-empty">No matching shortcuts</p>
              ) : (
                shortcutRows.map(([group, rows]) =>
                  rows.length ? (
                    <section key={group}>
                      <h3>{group}</h3>
                      <ul>
                        {rows.map((row) => (
                          <li key={`${group}/${row.label}/${row.shortcut}`}>
                            <span>{row.label}</span>
                            <kbd>{formatShortcut(row.shortcut, mac)}</kbd>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null,
                )
              )}
            </div>
            <p className="command-hint">
              {mac ? "⌃⌥M" : "Ctrl+Alt+M"} or F10 focuses the menu bar. Arrow
              keys move, Enter runs a command.
            </p>
          </div>
        ) : null}
      </PaletteActions.Provider>
    </CommandRegistry.Provider>
  );
}
