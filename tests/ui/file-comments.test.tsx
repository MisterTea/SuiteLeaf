// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileComments } from "../../apps/web/src/drive/file-comments";

const listed = [
  {
    id: "c1",
    itemId: "file",
    authorId: "sam",
    body: "Water the beds",
    createdAt: "2026-11-03T18:00:00.000Z",
  },
];

const comments = vi.fn(async () => listed);
const comment = vi.fn(async () => {});
const session = { user: { id: "maya", name: "Maya Chen" } as { id: string; name: string } | undefined };

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => (session.user ? { user: session.user } : null),
  drive: {
    comments: () => comments(),
    comment: (id: string, body: string) => comment(id, body),
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  comments.mockReset();
  comments.mockResolvedValue(listed);
  comment.mockReset();
  comment.mockResolvedValue(undefined);
});

it("writes an Arabic file comment from right to left", () => {
  const view = render(<FileComments itemId="file" canPost dir="rtl" />);
  expect(view.container.querySelector(".file-comments")?.getAttribute("dir")).toBe("rtl");
  view.unmount();
});

describe("file comments", () => {
  it("clears a dropped connection warning after the next successful poll", async () => {
    vi.useFakeTimers();
    comments.mockRejectedValueOnce(new Error("SuiteDrive is unreachable. Your changes stay on this device."));
    render(<FileComments itemId="file" canPost />);
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("SuiteDrive is unreachable");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.getByText("Water the beds")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits for a slow poll and preserves a failed comment and its draft after polling recovers", async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof listed) => void;
    comments.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<FileComments itemId="file" canPost />);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(comments).toHaveBeenCalledTimes(1);
    await act(async () => { finish(listed); });
    comment.mockRejectedValueOnce(new Error("Comment could not be posted."));
    const box = screen.getByLabelText("Add a comment");
    fireEvent.change(box, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(comments).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toBe("Comment could not be posted.");
    expect((box as HTMLTextAreaElement).value).toBe("Keep this draft");
  });
  it("provides a close button when the workspace opens it as a panel", async () => {
    const onClose = vi.fn();
    render(<FileComments itemId="file" canPost onClose={onClose} />);
    await screen.findByText("Water the beds");
    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("shows a comment beside the file and hides the box from a viewer", async () => {
    comments.mockRejectedValueOnce("offline");
    const { unmount } = render(<FileComments itemId="file" canPost={false} />);
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
    unmount();

    comments.mockResolvedValue(listed);
    render(<FileComments itemId="file" canPost={false} />);
    expect(await screen.findByText("Water the beds")).toBeTruthy();
    expect(screen.getByText("Someone")).toBeTruthy();
    expect(screen.getByText("Comments on this file.")).toBeTruthy();
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
  });

  it("lets a commenter write without saying the file text will change", async () => {
    render(<FileComments itemId="file" canPost wordingStays />);
    expect(await screen.findByText("Water the beds")).toBeTruthy();
    expect(screen.getByText("You can comment. The wording of the file stays as it is.")).toBeTruthy();
    const box = screen.getByLabelText("Add a comment");
    fireEvent.change(box, { target: { value: "North plot" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(comment).toHaveBeenCalledWith("file", "North plot"));
    expect(comment).toHaveBeenCalledTimes(1);
    fireEvent.change(box, { target: { value: "Beds" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(comment).toHaveBeenCalledWith("file", "Beds"));
  });

  it("shows a refusal and leaves an unchanged list in place", async () => {
    vi.useFakeTimers();
    render(<FileComments itemId="file" canPost />);
    await act(async () => {});
    const box = screen.getByLabelText("Add a comment");
    comment.mockRejectedValueOnce(new Error("You cannot comment on this file."));
    fireEvent.change(box, { target: { value: "West" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("You cannot comment on this file.");
    expect(screen.getByText("Water the beds")).toBeTruthy();
    comment.mockRejectedValueOnce("refused");
    fireEvent.change(box, { target: { value: "Plot" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("refused");
    comment.mockClear();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(comment).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Ripe" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await act(async () => {});
    expect(comment).toHaveBeenCalledWith("file", "Ripe");

    comments.mockResolvedValue([
      ...listed,
      {
        id: "c2",
        itemId: "file",
        authorId: "maya",
        body: "North plot",
        createdAt: "2026-11-03T18:01:00.000Z",
      },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText("Maya Chen")).toBeTruthy();
    expect(screen.getByText("North plot")).toBeTruthy();
    comments.mockResolvedValue([
      ...listed,
      {
        id: "c2",
        itemId: "file",
        authorId: "maya",
        body: "North plot",
        createdAt: "2026-11-03T18:01:00.000Z",
      },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText("North plot")).toBeTruthy();

    session.user = { id: "maya", name: "" };
    comments.mockResolvedValue([
      {
        id: "c3",
        itemId: "file",
        authorId: "maya",
        body: "Beds",
        createdAt: "2026-11-03T18:02:00.000Z",
      },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText("You")).toBeTruthy();
    session.user = { id: "maya", name: "Maya Chen" };
  }, 15000);
});
