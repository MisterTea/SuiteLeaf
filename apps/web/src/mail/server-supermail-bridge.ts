import type { NodeSession } from "../node-client";

export function ensureServerSupermailBridge(session: NodeSession) {
  if (typeof window === "undefined") return;

  // If already in electron with a native host bridge, do not overwrite unless running in server cluster mode
  if (window.supermail && (window.supermail as any).isElectron && !(window as any).__supermail_server_bridge__) {
    return;
  }

  const getHeaders = () => ({
    "content-type": "application/json",
    authorization: `Bearer ${session.token}`,
  });

  const baseUrl = `${session.url}/api/auth/suiteleaf/supermail`;

  const apiCall = async (endpoint: string, body: unknown = {}) => {
    const res = await fetch(`${baseUrl}/${endpoint}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `SuperMail server error (${res.status})`);
    }
    return data;
  };

  (window as any).__supermail_server_bridge__ = true;

  window.supermail = {
    db: {
      select: async <T = unknown>(
        query: string,
        params: unknown[] = [],
      ): Promise<T> => {
        return (await apiCall("db/select", { query, params })) as T;
      },
      execute: async (query: string, params: unknown[] = []) => {
        return (await apiCall("db/execute", { query, params })) as {
          rowsAffected: number;
          lastInsertId: number;
        };
      },
    },
    fs: {
      mkdir: async (path: string) => {
        await apiCall("fs/mkdir", { path });
      },
      writeFile: async (path: string, data: Uint8Array | string) => {
        let base64: string;
        if (typeof data === "string") {
          base64 = btoa(data);
        } else {
          let binary = "";
          const len = data.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(data[i]);
          }
          base64 = btoa(binary);
        }
        await apiCall("fs/writeFile", { path, data: base64 });
      },
      writeTextFile: async (path: string, text: string) => {
        await apiCall("fs/writeTextFile", { path, text });
      },
      readFile: async (path: string): Promise<Uint8Array> => {
        const res = await apiCall("fs/readFile", { path });
        const binary = atob(res.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      },
      readTextFile: async (path: string): Promise<string> => {
        const res = await apiCall("fs/readTextFile", { path });
        return res.text;
      },
      remove: async (path: string, options?: { recursive?: boolean }) => {
        await apiCall("fs/remove", { path, recursive: options?.recursive });
      },
      exists: async (path: string): Promise<boolean> => {
        const res = await apiCall("fs/exists", { path });
        return res.exists;
      },
    },
    dialog: {
      save: async (options?: { defaultPath?: string }) => {
        return (
          prompt("Save file as:", options?.defaultPath || "download") || null
        );
      },
      open: async () => null,
    },
    openUrl: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    invoke: async <T = unknown>(
      cmd: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      return (await apiCall("invoke", { cmd, args })) as T;
    },
  };
}
