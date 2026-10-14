// Browsers only open a file picker in response to the user's own click, so a
// tool that needs a file asks for it in the AI panel and waits.

export interface FileRequest {
  id: number;
  prompt: string;
  accept: string;
  resolve: (file: File | null) => void;
}

let current: FileRequest | null = null;
let next = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const fileRequestStore = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** Ask the user to choose a file. Resolves with null if they decline or time runs out. */
export function requestFile(prompt: string, accept: string, timeoutMs = 300_000): Promise<File | null> {
  current?.resolve(null);
  return new Promise((done) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (file: File | null) => {
      clearTimeout(timer);
      if (current?.id === request.id) {
        current = null;
        changed();
      }
      done(file);
    };
    const request: FileRequest = { id: next++, prompt, accept, resolve: finish };
    current = request;
    changed();
  });
}

export function cancelFileRequest() {
  current?.resolve(null);
}
