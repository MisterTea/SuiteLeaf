import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  mentionPieces,
  normalizeMentions,
  type DocMention,
  type MentionChoice,
} from "@suiteleaf/core/doc-comments";
import { getSession } from "../node-client";
import { loadMentionChoices } from "./doc-mentions";

export interface MentionBody {
  text: string;
  mentions: DocMention[];
}

export interface MentionFieldHandle {
  read: () => MentionBody;
  focus: () => void;
}

/** The @ query in the text node at the caret, once the person has typed @. */
export function mentionQuery(root: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.anchorNode) return null;
  if (!root.contains(selection.anchorNode)) return null;
  if (selection.anchorNode.nodeType !== Node.TEXT_NODE) return null;
  const text = selection.anchorNode.textContent ?? "";
  const upto = text.slice(0, selection.anchorOffset);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1] ?? "")) return null;
  const query = upto.slice(at + 1);
  if (/[\n@]/.test(query)) return null;
  return query;
}

/** Read the field. Mention chips are returned separately and are not part of `text`. */
export function readMentionField(root: HTMLElement): MentionBody {
  let text = "";
  const mentions: DocMention[] = [];
  const walk = (node: Node, block: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent ?? "").replace(/\u00a0/g, " ");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains("doc-mention") && node.dataset.name) {
      mentions.push({
        name: node.dataset.name,
        at: text.length,
        ...(node.dataset.email ? { email: node.dataset.email } : {}),
        ...(node.dataset.account ? { accountId: node.dataset.account } : {}),
      });
      return;
    }
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    const nextBlock = node.tagName === "DIV" || node.tagName === "P";
    if (nextBlock && block && text && !text.endsWith("\n")) text += "\n";
    node.childNodes.forEach((child) => walk(child, nextBlock));
  };
  root.childNodes.forEach((child) => walk(child, false));
  text = text.replace(/\n$/, "");
  return { text, mentions: normalizeMentions(mentions, text.length) };
}

function insertMention(root: HTMLElement, choice: MentionChoice) {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!selection || !node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  const text = node.textContent ?? "";
  const upto = text.slice(0, selection.anchorOffset);
  const at = upto.lastIndexOf("@");
  if (at < 0) return;
  const before = text.slice(0, at);
  const after = text.slice(selection.anchorOffset);
  const parent = node.parentNode;
  if (!parent) return;
  const lead = document.createTextNode(before);
  const chip = document.createElement("span");
  chip.className = "doc-mention";
  chip.contentEditable = "false";
  chip.dataset.name = choice.name;
  if (choice.email) chip.dataset.email = choice.email;
  if (choice.accountId) chip.dataset.account = choice.accountId;
  chip.textContent = choice.name;
  const spacer = after.startsWith(" ") ? after : ` ${after}`;
  const tail = document.createTextNode(spacer);
  parent.insertBefore(lead, node);
  parent.insertBefore(chip, node);
  parent.insertBefore(tail, node);
  parent.removeChild(node);
  const range = document.createRange();
  range.setStart(tail, 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Stays out of React's render so the caret and chips are not wiped when the menu opens. */
const FieldHost = memo(function FieldHost({
  hostRef,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
}) {
  return <div ref={hostRef} />;
});

function choiceDetail(choice: MentionChoice) {
  if (choice.unmatched) return "No account";
  if (choice.email) return choice.email;
  return "On this computer";
}

/**
 * Comment box that can hold mention chips. The menu opens after @ and two
 * characters. Enter inserts the highlighted name. There is no notify control.
 */
export const MentionField = forwardRef<
  MentionFieldHandle,
  {
    label: string;
    placeholder: string;
    onPost: () => void;
    onEscape: () => void;
    onInput?: () => void;
  }
>(function MentionField({ label, placeholder, onPost, onEscape, onInput }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const listId = useId();
  const onPostRef = useRef(onPost);
  const onEscapeRef = useRef(onEscape);
  const onInputRef = useRef(onInput);
  onPostRef.current = onPost;
  onEscapeRef.current = onEscape;
  onInputRef.current = onInput;
  const [query, setQuery] = useState<string | null>(null);
  const [choices, setChoices] = useState<MentionChoice[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const menu = useRef({ open: false, choices: [] as MentionChoice[], active: 0 });
  menu.current = { open, choices, active };

  useImperativeHandle(ref, () => ({
    read: () => (field.current ? readMentionField(field.current) : { text: "", mentions: [] }),
    focus: () => field.current?.focus(),
  }));

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const el = document.createElement("div");
    el.className = "doc-mention-field is-empty";
    el.contentEditable = "true";
    el.role = "textbox";
    el.spellcheck = true;
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-multiline", "true");
    el.setAttribute("aria-autocomplete", "list");
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("aria-controls", listId);
    el.dataset.placeholder = placeholder;
    root.appendChild(el);
    field.current = el;
    el.focus();
    const refresh = () => {
      const empty = !(el.textContent ?? "").trim() && !el.querySelector(".doc-mention");
      el.classList.toggle("is-empty", empty);
      setQuery(mentionQuery(el));
      onInputRef.current?.();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const state = menu.current;
      if (state.open && state.choices.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive((index) => (index + step + state.choices.length) % state.choices.length);
          return;
        }
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          const choice = state.choices[state.active] ?? state.choices[0];
          if (choice) insertMention(el, choice);
          setOpen(false);
          setQuery(null);
          refresh();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        onPostRef.current();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      if (!pasted) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(pasted);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      refresh();
    };
    el.addEventListener("input", refresh);
    el.addEventListener("keyup", refresh);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("paste", onPaste);
    return () => {
      el.remove();
      field.current = null;
    };
  }, [label, listId, placeholder]);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && choices[active]) el.setAttribute("aria-activedescendant", `${listId}-${active}`);
    else el.removeAttribute("aria-activedescendant");
  }, [active, choices, listId, open]);

  useEffect(() => {
    if (query === null || query.trim().length < 2) {
      setChoices([]);
      setOpen(false);
      setActive(0);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void loadMentionChoices(query).then((found) => {
        if (cancel) return;
        setChoices(found);
        setActive(0);
        setOpen(found.length > 0);
      });
    }, getSession() ? 180 : 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const pick = (choice: MentionChoice) => {
    const el = field.current;
    if (!el) return;
    insertMention(el, choice);
    setOpen(false);
    setQuery(null);
    el.classList.remove("is-empty");
    el.focus();
    onInputRef.current?.();
  };

  return (
    <div className="doc-mention-compose">
      <FieldHost hostRef={host} />
      {open ? (
        <ul id={listId} className="doc-mention-list" role="listbox" aria-label="Mention someone">
          {choices.map((choice, index) => (
            <li key={`${choice.accountId ?? choice.name}-${index}`}>
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(choice)}
              >
                <strong>{choice.name}</strong>
                <small>{choiceDetail(choice)}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

export function MentionText({ text, mentions }: { text: string; mentions?: unknown }) {
  const pieces = mentionPieces(text, mentions);
  if (!pieces.length) return <p></p>;
  return (
    <p>
      {pieces.map((piece, index) =>
        piece.kind === "mention" ? (
          <span key={index} className="doc-mention" data-mention={piece.name}>
            {piece.name}
          </span>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </p>
  );
}
