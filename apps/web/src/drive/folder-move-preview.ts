/** A person who can open an item. Direct grants stay with the file. */
export type MoveGrant = {
  principalId: string;
  name: string;
  inherited: boolean;
};

export type FolderMovePreview = {
  gain: string[];
  lose: string[];
  note: string;
  /** Compares this preview with the grants at commit. It is not a person id. */
  stamp: string;
};

function moveStamp(current: readonly MoveGrant[], nextFolder: readonly MoveGrant[]): string {
  const line = (grant: MoveGrant) => `${grant.principalId}\n${grant.inherited ? "1" : "0"}\n${grant.name}`;
  const body = [...current.map(line), "|", ...nextFolder.map(line)].join("\n");
  let hash = 5381;
  for (const char of body) hash = Math.imul(hash, 33) ^ char.charCodeAt(0);
  return (hash >>> 0).toString(16);
}

/**
 * Who would gain or lose access if this file moved into another folder.
 * Direct grants stay. Inherited access follows the destination folder.
 * Nothing is moved. Ids are not in the result.
 */
export function folderMovePreview(input: {
  current: readonly MoveGrant[];
  nextFolder: readonly MoveGrant[];
}): FolderMovePreview {
  const current = input.current.map((grant) => ({ ...grant }));
  const nextFolder = input.nextFolder.map((grant) => ({ ...grant }));
  const direct = new Set(current.filter((grant) => !grant.inherited).map((grant) => grant.principalId));
  const currentIds = new Set(current.map((grant) => grant.principalId));
  const nextIds = new Set([...direct, ...nextFolder.map((grant) => grant.principalId)]);
  const names = (grants: readonly MoveGrant[]) =>
    grants.map((grant) => grant.name.trim()).filter((name) => name.length > 0);
  const gained = nextFolder.filter((grant) => !currentIds.has(grant.principalId));
  const lost = current.filter(
    (grant) => grant.inherited && !direct.has(grant.principalId) && !nextIds.has(grant.principalId),
  );
  const gain = names(gained);
  const lose = names(lost);
  return {
    gain,
    lose,
    note:
      gained.length || lost.length
        ? "This move changes who has access."
        : "This move does not change who has access.",
    stamp: moveStamp(current, nextFolder),
  };
}

/**
 * Accept a folder-move preview only if the grants are still the same.
 * A changed plan is refused. Nothing is moved. Ids are not in the result.
 */
export function commitFolderMove(input: {
  stamp: string;
  current: readonly MoveGrant[];
  nextFolder: readonly MoveGrant[];
}): { ok: boolean; note: string } {
  const preview = folderMovePreview(input);
  if (input.stamp !== preview.stamp) {
    return { ok: false, note: "The access plan changed. Review it again." };
  }
  return { ok: true, note: preview.note };
}
