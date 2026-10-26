// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  marpDocument,
  renderMarpPages,
  sanitizeMarpHtml,
} from "../../apps/web/src/editors/slide-marp-render";
import { hideRenderedLines } from "../../apps/web/src/editors/slide-marp-backdrop";
import { buildMarpFile } from "../../apps/web/src/editors/slide-marp-import";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));

const ATTACK = `# Title

<img src="x" onerror="window.parent.pwned = true">

<div onclick="steal()" style="color: red">Styled</div>

<script>window.parent.pwned = true</script>

<a href="javascript:alert(1)">link</a>
`;

describe("authored HTML in MARP pages", () => {
  it("keeps markup, styles, and source lines and removes scripts and handlers", () => {
    const clean = sanitizeMarpHtml(
      '<p data-sl-lines="2,3" style="color: red">Hi <img src="x" onerror="bad()"></p><script>bad()</script><a href="javascript:bad()">x</a>',
    );
    expect(clean).toContain('data-sl-lines="2,3"');
    expect(clean).toContain('style="color: red"');
    expect(clean).not.toMatch(/onerror|<script|javascript:/);
  });

  it("only lets MARP's scaling code run, under a nonce", () => {
    const page = marpDocument({
      html: "<section><p>Hi</p></section>",
      css: "section{color:red}</style><script>bad()</script>",
      source: "# Hi",
      width: 1280,
      height: 720,
      scripts: [],
      themedCharts: false,
    });
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(page)?.[1];
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(page).toContain("default-src 'none'");
    expect(page).toContain(`<script nonce="${nonce}" data-suiteleaf-runtime>`);
    expect(page).not.toContain("</style><script>bad()");
    expect(page.match(/<script nonce=/g)).toHaveLength(1);
  });

  it("renders editor pages with source lines and nothing an author could run", () => {
    const file = buildMarpFile("Attack", ATTACK);
    const render = renderMarpPages(file.content, { sourceLines: true })!;
    const [page] = render.pages;
    expect(page.document).toContain('data-sl-lines="0,1"');
    expect(page.document).toContain("Styled");
    expect(page.document).not.toMatch(/onerror|onclick|javascript:|window\.parent\.pwned/);
    render.dispose();
    expect(renderMarpPages({ ...file.content, marpSource: `${ATTACK}\n<div>` })).toBeNull();
  });
});

describe("redrawing MARP pages", () => {
  it("names the same pictures again and keeps unchanged slides as they were", () => {
    let made = 0;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:pic-${++made}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const file = buildMarpFile("Pictures", "![](media/a.png)\n\n---\n\n# Two\n");
      const deck = {
        ...file.content,
        marpAssets: { "media/a.png": "data:image/png;base64,iVBORw0KGgo=" },
      };
      const first = renderMarpPages(deck, { sourceLines: true })!;
      const second = renderMarpPages(
        { ...deck, marpSource: deck.marpSource!.replace("# Two", "# Second") },
        { sourceLines: true, previous: first },
      )!;
      expect(first.pages[0].document).toContain("blob:pic-1");
      expect(second.pages[0]).toBe(first.pages[0]);
      expect(second.pages[1]).not.toBe(first.pages[1]);
      expect(second.pages[1].document).toContain("Second");
      expect(second.pages[1].document).toContain('data-sl-lines="');
      expect(second.pages[1].plain).not.toContain("data-sl-lines");
      expect(made).toBe(1);

      // A line added above moves the next slide's source lines but not its look.
      const plainBefore = second.pages[1].plain;
      const third = renderMarpPages(
        { ...deck, marpSource: deck.marpSource!.replace("# Two", "# Second").replace("![](media/a.png)", "![](media/a.png)\n\nMore") },
        { sourceLines: true, previous: second },
      )!;
      expect(third.pages[1]).not.toBe(second.pages[1]);
      expect(third.pages[1].plain).toBe(plainBefore);
      expect(third.pages[1].document).not.toBe(second.pages[1].document);
      third.dispose();

      first.dispose();
      expect(revoke).not.toHaveBeenCalled();
      second.dispose();
      second.dispose();
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith("blob:pic-1");
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });
});

describe("the slide drawn behind the boxes", () => {
  it("hides only the rendered blocks of the box being edited", () => {
    const doc = document.implementation.createHTMLDocument("page");
    doc.body.innerHTML =
      '<h1 data-sl-lines="0,1">Title</h1><ul data-sl-lines="2,5"><li data-sl-lines="2,3">a</li><li data-sl-lines="3,4">b</li></ul><p data-sl-lines="6,7">After</p>';
    const visible = () =>
      [...doc.querySelectorAll<HTMLElement>("[data-sl-lines]")].map((node) => node.style.visibility || "shown");
    expect(hideRenderedLines(doc, [2, 4])).toBe(true);
    expect(visible()).toEqual(["shown", "hidden", "hidden", "hidden", "shown"]);
    expect(hideRenderedLines(doc, null)).toBe(false);
    expect(visible()).toEqual(["shown", "shown", "shown", "shown", "shown"]);
    expect(hideRenderedLines(doc, [9, 10])).toBe(false);
  });
});
