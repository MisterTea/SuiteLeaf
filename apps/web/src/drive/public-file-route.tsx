import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import { parseFile, type SuiteFile } from "@suiteleaf/core";
import { useMode } from "../mode";
import { message } from "../error-message";
import { CommandPalette } from "../command-palette";

const Docs = lazy(() => import("../editors/Docs"));
const Sheets = lazy(() => import("../editors/Sheets"));
const Slides = lazy(() => import("../editors/Slides"));
const Drawing = lazy(() => import("../editors/Drawing"));
const Forms = lazy(() => import("../editors/Form"));
const ignore = () => {};

export async function loadPublicFile(
  server: string,
  token: string,
  signal?: AbortSignal,
): Promise<SuiteFile> {
  const response = await fetch(
    `${server}/api/public/files/${encodeURIComponent(token)}`,
    {
      signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "This public link is unavailable. It may have been revoked or public sharing may be turned off."
        : "The shared file could not be loaded. Try again later.",
    );
  return parseFile(await response.text());
}

class PublicFileBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: message(error) };
  }
  render() {
    return this.state.error ? (
      <p className="loading" role="alert">
        {this.state.error}
      </p>
    ) : (
      this.props.children
    );
  }
}

export function PublicFileRoute() {
  const { token = "" } = useParams();
  const { mode } = useMode();
  const server =
    mode.kind === "cluster" ? mode.serverUrl : window.location.origin;
  const [file, setFile] = useState<SuiteFile>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setFile(undefined);
    setError("");
    void loadPublicFile(server, token, controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setFile(file);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [server, token]);
  const props = {
    readOnly: true,
    onChange: ignore,
    onActions: ignore,
    onError: setError,
  };
  return (
    <main className="workspace public-file">
      <header className="workspace-header">
        <Link to="/">SuiteLeaf</Link>
        <h1>{file?.title ?? "Shared file"}</h1>
        <span>Public link · View only</span>
      </header>
      {error ? (
        <p className="loading" role="alert">
          {error}
        </p>
      ) : null}
      {file ? (
        <PublicFileBoundary key={token}>
          <CommandPalette kind={file.kind}>
            <Suspense fallback={<p className="loading">Opening viewer…</p>}>
              {file.kind === "doc" ? (
                <Docs
                  file={file}
                  {...props}
                  onCreateDocument={async () => {}}
                />
              ) : file.kind === "sheet" ? (
                <Sheets file={file} {...props} canComment={false} />
              ) : file.kind === "slide" ? (
                <Slides file={file} {...props} />
              ) : file.kind === "drawing" ? (
                <Drawing file={file} {...props} />
              ) : (
                <Forms file={file} {...props} canSubmit={false} />
              )}
            </Suspense>
          </CommandPalette>
        </PublicFileBoundary>
      ) : !error ? (
        <p className="loading">Loading shared file…</p>
      ) : null}
    </main>
  );
}
