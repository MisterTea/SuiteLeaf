import { useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import type { DocFile, JsonNode } from "@suiteleaf/core";

type DocChange = (
  content: DocFile["content"],
  extra?: { tabTitle?: string; tabs?: DocFile["tabs"] } | unknown,
) => void;

/** The open tab, every tab's title, and the bodies of the tabs that are not shown. */
export function useDocTabs(file: DocFile, changes: RefObject<DocChange>) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;
  const showTabRef = useRef<
    (index: number, focus?: "editor" | "find") => void
  >(() => {});
  const [tabTitle, setTabTitle] = useState(
    () => file.tabTitle?.trim() || "Document",
  );
  const tabTitleRef = useRef(tabTitle);
  tabTitleRef.current = tabTitle;
  const [extras, setExtras] = useState<
    { id: string; title: string; content: JsonNode }[]
  >(() =>
    (file.tabs ?? []).map((tab) => ({
      id: tab.id,
      title: tab.title,
      content: tab.content,
    })),
  );
  const extrasRef = useRef(extras);
  const firstBody = useRef<JsonNode>(file.content);
  const ignoreEdits = useRef(false);
  const publishTabs = () => {
    const title = tabTitleRef.current.trim();
    const tabs = extrasRef.current.map((tab, index) => ({
      id: tab.id,
      title: tab.title.trim() || `Tab ${index + 2}`,
      content: tab.content,
    }));
    changes.current(firstBody.current, {
      tabTitle: title && title !== "Document" ? title : undefined,
      tabs: tabs.length ? tabs : undefined,
    });
  };
  const writeBody = (json: JsonNode) => {
    if (activeRef.current === 0) firstBody.current = json;
    else {
      const index = activeRef.current - 1;
      extrasRef.current = extrasRef.current.map((tab, i) =>
        i === index ? { ...tab, content: json } : tab,
      );
    }
  };
  return {
    active,
    setActive,
    activeRef,
    showTabRef,
    tabTitle,
    setTabTitle,
    tabTitleRef,
    extras,
    setExtras,
    extrasRef,
    firstBody,
    ignoreEdits,
    publishTabs,
    writeBody,
  };
}

export type DocTabs = ReturnType<typeof useDocTabs>;

/** Switch, add, and rename tabs. The editor shows one tab's body at a time. */
export function docTabActions(
  editor: Editor,
  tabs: DocTabs,
  {
    readOnly,
    readOnlyRef,
    findInput,
  }: {
    readOnly: boolean;
    readOnlyRef: RefObject<boolean>;
    findInput: RefObject<HTMLInputElement | null>;
  },
) {
  const {
    active,
    setActive,
    activeRef,
    tabTitle,
    setTabTitle,
    tabTitleRef,
    extras,
    setExtras,
    extrasRef,
    firstBody,
    ignoreEdits,
    publishTabs,
    writeBody,
  } = tabs;
  const loadIntoEditor = (json: JsonNode, focusEditor = true) => {
    if (!editor || editor.isDestroyed) return;
    ignoreEdits.current = true;
    const doc = editor.schema.nodeFromJSON(json);
    editor.view.updateState(
      EditorState.create({
        schema: editor.schema,
        doc,
        plugins: editor.state.plugins,
      }),
    );
    ignoreEdits.current = false;
    if (focusEditor && !readOnlyRef.current) editor.commands.focus("end");
  };
  const showTab = (index: number, focus: "editor" | "find" = "editor") => {
    if (!editor || editor.isDestroyed || index === activeRef.current) return;
    if (index > 0 && !extrasRef.current[index - 1]) return;
    writeBody(editor.getJSON() as JsonNode);
    activeRef.current = index;
    setActive(index);
    loadIntoEditor(
      index === 0 ? firstBody.current : extrasRef.current[index - 1].content,
      focus === "editor",
    );
    publishTabs();
    if (focus === "find") {
      const input = findInput.current;
      if (input) {
        const pos = input.value.length;
        input.focus();
        input.setSelectionRange(pos, pos);
      }
    }
  };
  const addTab = () => {
    if (!editor || editor.isDestroyed || readOnly) return;
    writeBody(editor.getJSON() as JsonNode);
    const tab = {
      id: crypto.randomUUID(),
      title: `Tab ${extrasRef.current.length + 2}`,
      content: { type: "doc", content: [{ type: "paragraph" }] } as JsonNode,
    };
    extrasRef.current = [...extrasRef.current, tab];
    setExtras(extrasRef.current);
    activeRef.current = extrasRef.current.length;
    setActive(extrasRef.current.length);
    loadIntoEditor(tab.content);
    publishTabs();
  };
  const renameTab = (value: string) => {
    const clipped = value.slice(0, 80);
    if (activeRef.current === 0) {
      tabTitleRef.current = clipped;
      setTabTitle(clipped);
    } else {
      const index = activeRef.current - 1;
      extrasRef.current = extrasRef.current.map((tab, i) =>
        i === index ? { ...tab, title: clipped } : tab,
      );
      setExtras(extrasRef.current);
    }
    publishTabs();
  };
  const tabNames = [
    tabTitle.trim() || "Document",
    ...extras.map((tab, index) => tab.title.trim() || `Tab ${index + 2}`),
  ];
  const activeName = active === 0 ? tabTitle : (extras[active - 1]?.title ?? "");
  return { showTab, addTab, renameTab, tabNames, activeName };
}

export function DocTabBar({
  editor,
  readOnly,
  tabNames,
  extras,
  active,
  activeName,
  showTab,
  addTab,
  renameTab,
}: {
  editor: Editor | null;
  readOnly: boolean;
  tabNames: string[];
  extras: DocTabs["extras"];
  active: number;
  activeName: string;
  showTab: (index: number) => void;
  addTab: () => void;
  renameTab: (value: string) => void;
}) {
  return (
    <div className="doc-tab-bar">
      <div className="doc-tab-list" role="tablist" aria-label="Document tabs">
        {tabNames.map((name, index) => (
          <button
            key={index === 0 ? "first" : extras[index - 1].id}
            type="button"
            role="tab"
            className="document-tab"
            aria-selected={index === active}
            onClick={() => showTab(index)}
          >
            {name}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="doc-tab-add"
        disabled={readOnly || !editor}
        onClick={addTab}
      >
        Add tab
      </button>
      <label className="doc-tab-name">
        Tab name
        <input
          aria-label="Tab name"
          value={activeName}
          maxLength={80}
          disabled={readOnly}
          onChange={(event) => renameTab(event.target.value)}
        />
      </label>
    </div>
  );
}
