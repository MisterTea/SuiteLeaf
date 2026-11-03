import { describe, expect, it } from "vitest";
import { dependencyNotice } from "../apps/desktop/src/dependency-notice";

describe("dependency notice", () => {
  it("lists published versions and leaves a model file and a secret version out", () => {
    const notice = dependencyNotice({
      name: "SuiteLeaf",
      version: "0.4.2",
      dependencies: {
        react: "19.0.0",
        marked: "1.2.3 secret-value",
        "secret-model.gguf": "1.0.0",
        private: "secret-value",
      },
      devDependencies: {
        vitest: "4.1.11-beta.1",
      },
    });
    expect(notice.name).toBe("SuiteLeaf");
    expect(notice.version).toBe("0.4.2");
    expect(notice.dependencies).toEqual([
      { name: "marked", version: "1.2.3" },
      { name: "react", version: "19.0.0" },
      { name: "vitest", version: "4.1.11-beta.1" },
    ]);
    expect(notice.omitted).toBe(2);
    expect(notice.note).toContain("model files are not included");
    expect(JSON.stringify(notice)).not.toContain("secret-value");
    expect(JSON.stringify(notice)).not.toContain(".gguf");
  });
});
