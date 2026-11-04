// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    render(<FileComments itemId="file" canPost />);
    const box = await screen.findByLabelText("Add a comment");
    comment.mockRejectedValueOnce(new Error("You cannot comment on this file."));
    fireEvent.change(box, { target: { value: "West" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You cannot comment on this file.");
    expect(screen.getByText("Water the beds")).toBeTruthy();
    comment.mockRejectedValueOnce("refused");
    fireEvent.change(box, { target: { value: "Plot" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect((await screen.findByRole("alert")).textContent).toContain("refused");
    comment.mockClear();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(comment).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Ripe" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(comment).toHaveBeenCalledWith("file", "Ripe"));

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
    await new Promise((resolve) => setTimeout(resolve, 2100));
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
    await new Promise((resolve) => setTimeout(resolve, 2100));
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
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(screen.getByText("You")).toBeTruthy();
    session.user = { id: "maya", name: "Maya Chen" };
  }, 15000);
});
