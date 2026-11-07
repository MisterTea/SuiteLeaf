import { spawnSync } from "node:child_process";

const windows = process.platform === "win32";
const python = process.env.PYTHON ?? (windows ? "python" : "python3");
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(python, ["-m", "venv", ".venv-fonts"]);
run(windows ? ".venv-fonts/Scripts/python.exe" : ".venv-fonts/bin/python", [
  "-m", "pip", "install", "-r", "scripts/fonts/requirements-test.txt",
]);
