export interface PublicQuestion {
  id: string;
  prompt: string;
  kind: "text" | "choice" | "rating" | "grid" | "file" | "number";
  min?: number;
  max?: number;
  required: boolean;
  choices?: string[];
  branches?: { when: string; next: string }[];
  rows?: string[];
  columns?: string[];
}

export interface PublicForm {
  title: string;
  questions: PublicQuestion[];
  /** Missing on an older response means the form is still open. */
  accepting?: boolean;
  deadline?: string;
}

/** The sign-up page. These requests do not send a SuiteLeaf session. */
export async function loadSignUp(token: string): Promise<PublicForm> {
  const response = await fetch(
    `${location.origin}/api/respond/${encodeURIComponent(token)}`,
  );
  if (!response.ok) throw new Error("closed");
  return response.json();
}

export async function submitSignUp(
  token: string,
  answers: Record<string, string>,
): Promise<void> {
  const response = await fetch(
    `${location.origin}/api/respond/${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  );
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  if (response.status === 400 && body.error) throw new Error(body.error);
  throw new Error("closed");
}
