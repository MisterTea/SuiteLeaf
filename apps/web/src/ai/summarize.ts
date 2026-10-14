import {
  changeExcerpt,
  summaryPrompt,
  type StoredVersion,
  type SuiteFile,
} from "@suiteleaf/core";
import { AI_MODELS } from "@suiteleaf/core/ai";
import { localModel } from "./backend";

function clean(text: string): string | null {
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|im_end\|>/g, "")
    .trim();
  const sentence = stripped
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!sentence) return null;
  return sentence.length <= 200 ? sentence : `${sentence.slice(0, 199).trimEnd()}…`;
}

/** One sentence from FrogNano with thinking already closed. Null if it cannot run. */
export async function frogSummary(
  file: SuiteFile,
  version: StoredVersion,
): Promise<string | null> {
  const versions = file.versions ?? [];
  const index = versions.findIndex((item) => item.id === version.id);
  const previous = index > 0 ? versions[index - 1] : null;
  const excerpt = changeExcerpt(
    file.kind,
    {
      title: previous?.title ?? file.title,
      content: previous?.content ?? { type: "doc", content: [] },
    },
    { title: version.title, content: version.content },
  );
  const prompt = summaryPrompt(file.kind, excerpt.before, excerpt.after);
  try {
    const model = localModel();
    const status = await model.load();
    if (status.state !== "ready") return null;
    const info = AI_MODELS["frognano-4b"];
    return await new Promise((resolve) => {
      let text = "";
      model.generate(
        {
          prompt,
          maxTokens: 80,
          stop: info.stop,
          temperature: 0.2,
          topK: info.sampling.topK,
          topP: info.sampling.topP,
        },
        (event) => {
          if (event.type === "text") text += event.text;
          else if (event.type === "done") resolve(clean(text));
          else if (event.type === "error") resolve(null);
        },
      );
    });
  } catch {
    return null;
  }
}
