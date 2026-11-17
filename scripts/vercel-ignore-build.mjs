import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Unknown paths build conservatively. Package manifests and deployment
 * configuration always build, including desktop's workspace manifest. */
export function affectsCloud(path) {
  return !(
    /^(docs|tests|storyboards|project_management|\.github)\//.test(path) ||
    /^[^/]+\.md$/i.test(path) ||
    /^apps\/desktop\/(?!package\.json$)/.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

export function ignoreBuild(env = process.env) {
  // Compare with the previous deployment, not HEAD^: a deployment may contain
  // multiple commits. Missing history and first deployments must still build.
  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  if (env.VERCEL_FORCE_BUILD === "1" || !/^[a-f0-9]{40}$/i.test(previous ?? ""))
    return false;
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "-z", previous, "HEAD", "--"],
    { encoding: "utf8" },
  );
  if (diff.status !== 0) return false;
  return !diff.stdout.split("\0").filter(Boolean).some(affectsCloud);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const ignore = ignoreBuild();
  console.log(
    ignore
      ? "Skipping: no cloud artifact changes since the previous deployment."
      : "Building: cloud inputs changed, build forced, or history unavailable.",
  );
  process.exitCode = ignore ? 0 : 1;
}
