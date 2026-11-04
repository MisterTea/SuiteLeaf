import { useEffect, useState } from "react";
import { readPersonalDictionary, SPELLING_CHANGED_EVENT } from "./doc-spelling";
import { readIgnoredCells, readIgnoredWords } from "./grid-spelling";

export function usePersonalDictionary() {
  const [dictionary, setDictionary] = useState(readPersonalDictionary);
  useEffect(() => {
    const sync = () => setDictionary(readPersonalDictionary());
    window.addEventListener(SPELLING_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPELLING_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return dictionary;
}

export function useIgnoredWords(fileId: string) {
  const [words, setWords] = useState(() => readIgnoredWords(fileId));
  useEffect(() => {
    const sync = () => setWords(readIgnoredWords(fileId));
    window.addEventListener(SPELLING_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPELLING_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [fileId]);
  return words;
}

export function useIgnoredCells(fileId: string) {
  const [cells, setCells] = useState(() => readIgnoredCells(fileId));
  useEffect(() => {
    const sync = () => setCells(readIgnoredCells(fileId));
    window.addEventListener(SPELLING_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPELLING_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [fileId]);
  return cells;
}

export function useSpellCursor(count: number, open: boolean) {
  const [cursor, setCursor] = useState(0);
  const index = count ? Math.min(cursor, count - 1) : 0;
  const restart = () => setCursor(0);
  return { index: open ? index : 0, restart };
}
