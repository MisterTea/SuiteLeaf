import { useState } from "react";
import { safeEmailHtml } from "./email-html";
export { safeEmailHtml } from "./email-html";
import { downloadAttachment, mailCall, type Message } from "./client";
import { Conversation } from "./Conversation";
import { AttachmentPreview } from "./AttachmentPreview";
import { MailAssistant } from "./MailAssistant";

export function MessageView({
  message,
  accountId,
  folder,
  uidValidity,
  onReply,
  onClose,
  gmail = false,
}: {
  message: Message;
  accountId: string;
  folder: string;
  uidValidity: string;
  onReply: (kind: "reply" | "all" | "forward") => void;
  onClose: () => void;
  gmail?: boolean;
}) {
  const [images, setImages] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <article className="mail-message">
      <header>
        <button onClick={onClose}>Back to messages</button>
        <button onClick={() => window.print()}>Print</button>
        <button
          onClick={() => {
            void mailCall<{
              filename: string;
              contentType: string;
              content: string;
            }>("original", { accountId, folder, uidValidity, uid: message.uid })
              .then(downloadAttachment)
              .catch((e) => setError(e.message));
          }}
        >
          Download original
        </button>
        {message.senderAddress && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Block ${message.senderAddress}? Future matching mail will be filtered on the server.`,
                )
              )
                void mailCall(
                  gmail ? "gmailFilter" : "saveRule",
                  gmail
                    ? {
                        accountId,
                        query: `from:${message.senderAddress}`,
                        addLabelIds: ["TRASH"],
                        removeLabelIds: ["INBOX"],
                      }
                    : {
                        accountId,
                        rule: {
                          name: `Block ${message.senderAddress}`,
                          query: `from:${message.senderAddress}`,
                          markRead: true,
                          moveTo: "SuiteLeaf Blocked",
                          enabled: true,
                        },
                      },
                )
                  .then(() =>
                    setNotice(
                      "Sender blocked. You can remove this rule in Mail settings or Mail preferences.",
                    ),
                  )
                  .catch((e) => setError(e.message));
            }}
          >
            Block sender
          </button>
        )}
      </header>
      <h2>{message.subject}</h2>
      <Conversation
        accountId={accountId}
        folder={folder}
        uidValidity={uidValidity}
        uid={message.uid}
      />
      <p>
        <strong>{message.from}</strong>
        <br />
        To: {message.to?.text}
        {message.cc?.text && (
          <>
            <br />
            Cc: {message.cc.text}
          </>
        )}
        <br />
        <time>{message.date && new Date(message.date).toLocaleString()}</time>
      </p>
      {message.html ? (
        <>
          <button onClick={() => setImages((v) => !v)}>
            {images ? "Hide remote images" : "Show remote images"}
          </button>
          <iframe
            title="Email content"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={safeEmailHtml(message.html, images)}
          />
        </>
      ) : (
        <pre>{message.text}</pre>
      )}
      {message.attachments.length > 0 && (
        <section aria-label="Attachments">
          <h3>Attachments</h3>
          {message.attachments.map((a) => (
            <button
              key={a.index}
              onClick={() => {
                void mailCall<{
                  filename: string;
                  contentType: string;
                  content: string;
                }>("attachment", {
                  accountId,
                  folder,
                  uidValidity,
                  uid: message.uid,
                  index: a.index,
                })
                  .then(downloadAttachment)
                  .catch((e) => setError(e.message));
              }}
            >
              {a.filename} · {Math.ceil(a.size / 1024)} KB
            </button>
          ))}
          <AttachmentPreview
            accountId={accountId}
            folder={folder}
            uidValidity={uidValidity}
            uid={message.uid}
            attachments={message.attachments}
          />
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <footer>
        <MailAssistant text={message.text} />
        <button onClick={() => onReply("reply")}>Reply</button>
        <button onClick={() => onReply("all")}>Reply all</button>
        <button onClick={() => onReply("forward")}>Forward</button>
      </footer>
    </article>
  );
}
