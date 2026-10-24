import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Keep private registry/recovery data separate from the cloud document folder. */
export function localDataDirectory(home = homedir()) {
  return join(home, ".config", "suiteleaf");
}

/** Copy legacy metadata once; never overwrite current data or remove originals. */
export async function migrateLocalData(
  legacyUserData: string,
  directory: string,
) {
  await mkdir(directory, { recursive: true });
  for (const [source, name] of [
    [join(legacyUserData, "settings.json"), "settings.json"],
    [join(legacyUserData, "library", "library.json"), "library.json"],
    [join(legacyUserData, "library", "dismissed.json"), "dismissed.json"],
  ]) {
    try {
      await copyFile(source, join(directory, name), constants.COPYFILE_EXCL);
    } catch (error) {
      if (
        !["ENOENT", "EEXIST"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
  }
}
