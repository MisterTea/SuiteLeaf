import { vi } from "vitest";

/** Just enough of Univer for the Sheets editor to start, sign in, and open a workbook. */
export function fakeEngine() {
  const users = { setCurrentUser: vi.fn() };
  const services = new Map<unknown, unknown>([["UserManagerService", users]]);
  const injector = { get: (token: unknown) => services.get(token) ?? {} };
  const sheet = {
    getSheetId: () => "s1",
    getMaxRows: () => 10,
    getMaxColumns: () => 5,
    getRange: (label: string) => ({ getRawValues: () => [[label]] }),
  };
  const workbook = {
    getActiveSheet: () => sheet,
    getSheetBySheetId: (id: string) => (id === "s1" ? sheet : null),
  };
  const commentEvent = { dispose: vi.fn() };
  const engine = {
    users,
    sheet,
    workbook,
    commentEvent,
    beforeCommand: null as null | ((event: { id: string; params?: unknown; cancel?: boolean }) => void),
    univer: { __getInjector: () => injector, dispose: vi.fn() },
    univerAPI: {
      Enum: { BuiltInUIPart: { HEADER: "header" }, ImageSourceType: { BASE64: "base64" } },
      Event: { BeforeCommandExecute: "before-command" },
      executeCommand: vi.fn(async () => true),
      setUIVisible: vi.fn(),
      registerComponent: vi.fn(),
      toggleDarkMode: vi.fn(),
      setTheme: vi.fn(),
      addEvent: vi.fn((_name: string, handler: (event: never) => void) => {
        engine.beforeCommand = handler as typeof engine.beforeCommand;
        return commentEvent;
      }),
      createWorkbook: vi.fn<(data: unknown) => typeof workbook>(() => workbook),
    },
  };
  return engine;
}
