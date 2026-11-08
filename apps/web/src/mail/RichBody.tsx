import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export function RichBody({
  html,
  text,
  disabled,
  onChange,
}: {
  html?: string;
  text: string;
  disabled: boolean;
  onChange: (text: string, html: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content:
      html ||
      text
        .split("\n")
        .map(
          (line) =>
            `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
        )
        .join(""),
    editable: !disabled,
    editorProps: {
      attributes: {
        "aria-label": "Rich message",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getText(), editor.getHTML()),
  });
  if (!editor) return null;
  return (
    <div className="mail-rich-body">
      <div role="toolbar" aria-label="Message formatting">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          Underline
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Bullet list
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          Numbered list
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const url = window.prompt("Link URL (https://)");
            if (url && /^https?:\/\//i.test(url))
              editor.chain().focus().setLink({ href: url }).run();
          }}
        >
          Insert link
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        >
          Clear formatting
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().undo().run()}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().redo().run()}
        >
          Redo
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
