import { useEffect, useState } from "react";
import { mailCall, type Attachment } from "./client";
interface PreviewFile {
  filename: string;
  contentType: string;
  content: string;
}
export function AttachmentPreview(
  props: (
    | {
        accountId: string;
        folder: string;
        uidValidity: string;
        uid: number;
      }
    | { loadFile: (index: number) => Promise<PreviewFile> }
  ) & { attachments: Attachment[] },
) {
  const { attachments } = props;
  const [preview, setPreview] = useState<{
      name: string;
      type: string;
      url?: string;
      text?: string;
    }>(),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const supported = (type: string) =>
    /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(type);
  return (
    <section aria-label="Attachment preview">
      <label>
        Preview attachment
        <select
          value=""
          onChange={(e) => {
            const attachment = attachments.find(
              (a) => a.index === Number(e.target.value),
            );
            if (!attachment) return;
            setError("");
            const load =
              "loadFile" in props
                ? props.loadFile(attachment.index)
                : mailCall<PreviewFile>("attachment", {
                    accountId: props.accountId,
                    folder: props.folder,
                    uidValidity: props.uidValidity,
                    uid: props.uid,
                    index: attachment.index,
                  });
            void load
              .then((file) => {
                if (!supported(file.contentType))
                  throw new Error("This attachment type must be downloaded.");
                const bytes = Uint8Array.from(atob(file.content), (c) =>
                  c.charCodeAt(0),
                );
                setPreview(
                  file.contentType === "text/plain"
                    ? {
                        name: file.filename,
                        type: file.contentType,
                        text: new TextDecoder().decode(bytes),
                      }
                    : {
                        name: file.filename,
                        type: file.contentType,
                        url: URL.createObjectURL(
                          new Blob([bytes], { type: file.contentType }),
                        ),
                      },
                );
              })
              .catch((e) => setError(e.message));
          }}
        >
          <option value="">Choose a file…</option>
          {attachments
            .filter((a) => supported(a.contentType))
            .map((a) => (
              <option key={a.index} value={a.index}>
                {a.filename}
              </option>
            ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div>
          <h3>{preview.name}</h3>
          <button onClick={() => setPreview(undefined)}>
            Close attachment preview
          </button>
          {preview.text !== undefined ? (
            <pre>{preview.text}</pre>
          ) : preview.type.startsWith("image/") ? (
            <img alt={preview.name} src={preview.url} />
          ) : (
            <iframe title={preview.name} src={preview.url} sandbox="" />
          )}
        </div>
      )}
    </section>
  );
}
