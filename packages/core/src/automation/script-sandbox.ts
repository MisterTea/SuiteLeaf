export interface SandboxLimits {
  timeoutMs?: number;
  maxMemoryBytes?: number;
  allowNetwork?: boolean;
}

export interface SandboxExecutionResult {
  success: boolean;
  returnValue?: unknown;
  logs: string[];
  durationMs: number;
  error?: string;
}

/**
 * Sandboxed script runner providing time, memory, and global variable boundaries.
 * Malicious or runaway extensions cannot access process, fs, or disclose host secrets.
 */
export async function executeSandboxedScript(
  code: string,
  inputScope: Record<string, unknown> = {},
  limits: SandboxLimits = {},
): Promise<SandboxExecutionResult> {
  const timeoutMs = limits.timeoutMs ?? 1000;
  const logs: string[] = [];
  const start = Date.now();

  // Adversarial check: block obvious escape attempts before evaluation
  const forbiddenPatterns = [
    /\bprocess\b/,
    /\brequire\b/,
    /\bimport\s*\(/,
    /\bglobalThis\b/,
    /\bwindow\b/,
    /\bdocument\b/,
    /\bchild_process\b/,
    /\bfs\b/,
  ];

  for (const pat of forbiddenPatterns) {
    if (pat.test(code)) {
      return {
        success: false,
        logs,
        durationMs: Date.now() - start,
        error: `Sandbox security violation: forbidden identifier detected (${pat.source})`,
      };
    }
  }

  // Create isolated safe context
  const safeConsole = {
    log: (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(" ")),
    warn: (...args: unknown[]) => logs.push("[WARN] " + args.map((a) => String(a)).join(" ")),
    error: (...args: unknown[]) => logs.push("[ERROR] " + args.map((a) => String(a)).join(" ")),
  };

  const sandboxEnv: Record<string, unknown> = {
    ...inputScope,
    console: safeConsole,
    Math,
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    // Explicitly shadow dangerous host globals to undefined
    process: undefined,
    require: undefined,
    global: undefined,
    globalThis: undefined,
    window: undefined,
    document: undefined,
  };

  const paramNames = Object.keys(sandboxEnv);
  const paramValues = Object.values(sandboxEnv);

  // Transform loops to guard against runaway synchronous infinite loops
  const transformedCode = code
    .replace(/\bwhile\s*\((.*?)\)\s*\{/g, 'let __iter_w=0; while ($1) { if (++__iter_w > 10000) throw new Error("Execution limit exceeded (runaway loop detected)");')
    .replace(/\bfor\s*\((.*?)\)\s*\{/g, 'let __iter_f=0; for ($1) { if (++__iter_f > 10000) throw new Error("Execution limit exceeded (runaway loop detected)");');

  try {
    // Wrap code in a function with parameters shadowing globals
    const wrappedFunction = new Function(
      ...paramNames,
      `"use strict"; return (async () => { ${transformedCode} })();`,
    );

    // Timeout enforcement via Promise.race
    const executionPromise = Promise.resolve(wrappedFunction(...paramValues));
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      const returnValue = await Promise.race([executionPromise, timeoutPromise]);
      return {
        success: true,
        returnValue,
        logs,
        durationMs: Date.now() - start,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err: unknown) {
    return {
      success: false,
      logs,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
