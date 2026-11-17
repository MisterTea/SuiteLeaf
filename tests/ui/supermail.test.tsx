// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MailRoute } from "../../apps/web/src/mail/MailApp";
import { ModeContext } from "../../apps/web/src/mode";

describe("SuperMail Integration in SuiteLeaf", () => {
  beforeEach(() => {
    (window as any).supermail = {
      isElectron: true,
      db: {
        select: vi.fn().mockResolvedValue([]),
        execute: vi.fn().mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 }),
      },
      openUrl: vi.fn().mockResolvedValue(undefined),
      fs: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(new Uint8Array()),
        remove: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).supermail;
  });

  it("renders SuperMailView when running in desktop mode with window.supermail", async () => {
    render(
      <MemoryRouter>
        <ModeContext.Provider
          value={{
            mode: { kind: "single" } as any,
            setMode: vi.fn(),
            locked: false,
          }}
        >
          <MailRoute />
        </ModeContext.Provider>
      </MemoryRouter>,
    );

    // It should render SuperMailView (or fallback while loading)
    expect(screen.getByText(/loading supermail/i)).toBeDefined();
  });

  it("renders SuperMailView when in server mode (cluster mode)", async () => {
    delete (window as any).supermail;

    render(
      <MemoryRouter>
        <ModeContext.Provider
          value={{
            mode: { kind: "cluster", serverUrl: "https://suiteleaf.example" } as any,
            setMode: vi.fn(),
            locked: false,
          }}
        >
          <MailRoute />
        </ModeContext.Provider>
      </MemoryRouter>,
    );

    // It should render SuperMailView (or fallback while loading)
    expect(screen.getByText(/loading supermail/i)).toBeDefined();
  });

  it("renders fallback message when in single mode without window.supermail or cluster", () => {
    delete (window as any).supermail;

    render(
      <MemoryRouter>
        <ModeContext.Provider
          value={{
            mode: { kind: "single" } as any,
            setMode: vi.fn(),
            locked: false,
          }}
        >
          <MailRoute />
        </ModeContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/mail requires server mode/i)).toBeDefined();
  });
});
