import { describe, expect, it } from "vitest";
import { releaseNotice } from "../apps/desktop/src/release-notice";

describe("release notice", () => {
  it("lists editor components apart from model downloads", () => {
    const notice = releaseNotice({
      version: "0.2.0",
      installerSha256: "abc",
      signatureMatched: true,
      schemaVersion: 5,
      editor: [
        { name: "yjs", version: "13.6.27", license: "MIT" },
        { name: "prosemirror-model", version: "1.25.0", license: "MIT" },
      ],
      models: [{ name: "garden-model", sha256: "def" }],
    });
    expect(notice.signature).toBe("matched");
    expect(notice.editor.map((component) => component.name)).toEqual([
      "prosemirror-model",
      "yjs",
    ]);
    expect(notice.text).toContain("SuiteLeaf 0.2.0");
    expect(notice.text).toContain("installer abc");
    expect(notice.text).toContain("signature matched");
    expect(notice.text).toContain("prosemirror-model 1.25.0 MIT");
    expect(notice.text).toContain("garden-model def is not part of the editor update");
    expect(notice.text.indexOf("editor")).toBeLessThan(notice.text.indexOf("models"));
    expect(notice.text).not.toContain("secret-value");

    const rejected = releaseNotice({
      version: "0.9.0",
      installerSha256: "abc",
      signatureMatched: false,
      schemaVersion: 5,
      editor: [{ name: "yjs", version: "13.6.27", license: "MIT" }],
      models: [],
    });
    expect(rejected.signature).toBe("rejected");
    expect(rejected.text).toContain("signature rejected");
    expect(rejected.text).not.toContain("garden-model");

    expect(() =>
      releaseNotice({
        version: "0.2.0",
        installerSha256: "abc",
        signatureMatched: true,
        schemaVersion: 5,
        editor: [
          { name: "secret-value", version: "1.0.0", license: "MIT" },
          { name: "yjs", version: "13.6.27", license: "MIT" },
        ],
        models: [{ name: "secret-value", sha256: "def" }],
      }),
    ).toThrow("A model download is not an editor component.");
  });
});