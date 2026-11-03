export type FlowBlock = {
  lines: number;
  keepNext?: boolean;
  /** Keep at least two lines together at a page break. */
  widowControl?: boolean;
};

/** How many lines of a paragraph stay on the page already in progress. */
export function widowSplit(
  lines: number,
  linesPerPage: number,
  used: number,
  control: boolean,
): number {
  const limit = Math.max(1, Math.floor(linesPerPage));
  const room = Math.max(0, limit - Math.max(0, Math.floor(used)));
  const count = Math.max(0, Math.floor(lines));
  if (count <= room) return count;
  if (!control || count < 2) return room;
  if (room <= 1) return 0;
  const remainder = count - room;
  if (remainder % limit === 1) return room - 1;
  return room;
}

/**
 * Page index of each block. A keep-with-next block moves with the following
 * block when they fit together and would otherwise be split by the page end.
 */
export function keepWithNextLayout(
  blocks: readonly FlowBlock[],
  linesPerPage: number,
): { pages: number[]; count: number } {
  const limit = Math.max(1, Math.floor(linesPerPage));
  const pages: number[] = [];
  let page = 0;
  let used = 0;
  for (let index = 0; index < blocks.length; index++) {
    const lines = Math.max(0, Math.floor(blocks[index].lines));
    const follower = blocks[index + 1];
    if (blocks[index].keepNext && follower && used > 0) {
      const follow = Math.max(0, Math.floor(follower.lines));
      if (lines + follow <= limit && used + lines + follow > limit) {
        page += 1;
        used = 0;
      }
    } else if (
      !blocks[index].widowControl &&
      used > 0 &&
      lines > 0 &&
      lines <= limit &&
      used + lines > limit
    ) {
      page += 1;
      used = 0;
    }
    if (blocks[index].widowControl && lines >= 2) {
      let left = lines;
      let started = false;
      while (left > 0) {
        const onThis = widowSplit(left, limit, used, true);
        if (onThis === 0) {
          if (used === 0) {
            if (!started) {
              pages.push(page);
              started = true;
            }
            left -= 1;
            page += 1;
            continue;
          }
          page += 1;
          used = 0;
          continue;
        }
        if (!started) {
          pages.push(page);
          started = true;
        }
        used += onThis;
        left -= onThis;
        if (used >= limit) {
          page += 1;
          used = 0;
        }
      }
      continue;
    }
    pages.push(page);
    if (lines > limit) {
      const extra = Math.ceil(lines / limit) - 1;
      page += extra;
      used = lines % limit;
      if (used === 0) {
        page += 1;
        used = 0;
      }
    } else {
      used += lines;
      if (used >= limit) {
        page += 1;
        used = 0;
      }
    }
  }
  const count = used === 0 && page > 0 ? page : page + 1;
  return { pages, count };
}
