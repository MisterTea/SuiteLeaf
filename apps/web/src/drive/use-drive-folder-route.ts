import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { message } from "../error-message";
import {
  driveFolderUrl,
  resolveDriveFolder,
  type DrivePlace,
} from "./drive-folder-url";

export type DriveFolderRoute = {
  pathname: string;
  search: string;
  navigate: (
    path: string,
    options?: { replace?: boolean },
  ) => void | Promise<void>;
};

/** URL changes load a folder; local browsing publishes a history entry once. */
export function useDriveFolderRoute(
  route: DriveFolderRoute | undefined,
  place: DrivePlace,
  setPlace: Dispatch<SetStateAction<DrivePlace>>,
) {
  const [pending, setPending] = useState(!!route);
  const [error, setError] = useState("");
  const current = useRef(place);
  current.current = place;
  const published = useRef<string | undefined>(undefined);
  const revision = useRef(0);
  const pathname = route?.pathname;
  const search = route?.search;
  const navigate = route?.navigate;
  useEffect(() => {
    if (pathname === undefined || search === undefined || !navigate) return;
    const key = pathname + search;
    if (published.current === key) {
      published.current = undefined;
      setPending(false);
      return;
    }
    const n = ++revision.current;
    let active = true;
    setPending(true);
    setError("");
    const next = /^\/drive(?:\/|$)/.test(pathname)
      ? resolveDriveFolder(pathname, search)
      : Promise.resolve(current.current);
    void next
      .then((place) => {
        if (!active || revision.current !== n) return;
        setPlace(place);
        const canonical = driveFolderUrl(place);
        if (canonical !== key) {
          published.current = canonical;
          void navigate(canonical, { replace: true });
        }
      })
      .catch((e) => {
        if (active && revision.current === n) setError(message(e));
      })
      .finally(() => {
        if (active && revision.current === n) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [pathname, search, navigate, setPlace]);

  const visit = useCallback(
    (next: DrivePlace) => {
      revision.current++;
      setPending(false);
      setError("");
      setPlace(next);
      if (navigate) {
        const url = driveFolderUrl(next);
        if (url !== pathname! + search!) {
          published.current = url;
          void navigate(url);
        }
      }
    },
    [navigate, pathname, search, setPlace],
  );
  return { pending, error, visit };
}
