import { DocumentSettings, SettingsPage } from "./document-settings";
import { useEffect, useState, type ReactNode } from "react";
import {
  HashRouter,
  Link,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  completeHandoff,
  finishSignOut,
  pendingHandoffUrl,
} from "./node-client";
import SignUpPage from "./sign-up";
import { AdminScreen } from "./admin/Admin";
import { SignInScreen, useNodeSession } from "./drive/SignIn";
import { ModeContext, resolveMode, useMode, type ResolvedMode } from "./mode";
import { AgentLayer } from "./ai/AgentSidebar";
import { TemplateGallery } from "./templates/gallery";
import { disconnectFromServer } from "./drive/drive-files";
import { message } from "./error-message";
import { LocalHome } from "./home/LocalHome";
import { ClusterHome } from "./home/ClusterHome";
import { Workspace } from "./workspace/Workspace";
import { PublicFileRoute } from "./drive/public-file-route";
import { SharedFileRoute } from "./drive/shared-file-route";

function AppTools() {
  const { pathname } = useLocation();
  return pathname.startsWith("/public/") ? null : (
    <>
      <AgentLayer />
      <DocumentSettings />
    </>
  );
}

function Home() {
  const { mode } = useMode();
  return mode.kind === "cluster" ? (
    <ClusterHome serverUrl={mode.serverUrl} />
  ) : (
    <LocalHome />
  );
}
const handledTokens = new Set<string>();
function AuthComplete() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { mode } = useMode();
  const [error, setError] = useState("");
  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      void navigate("/", { replace: true });
      return;
    }
    if (handledTokens.has(token)) return;
    handledTokens.add(token);
    const server =
      pendingHandoffUrl() ?? (mode.kind === "cluster" ? mode.serverUrl : null);
    if (!server) {
      setError("This app is not connected to a SuiteLeaf server.");
      return;
    }
    completeHandoff(server, token)
      .then(() => navigate("/", { replace: true }))
      .catch((e) => setError(message(e)));
  }, [params, navigate, mode]);
  return (
    <div className="loading">
      {error ? (
        <>
          <h2>Sign-in did not complete</h2>
          <p>{error}</p>
          <Link to="/">Return to files</Link>
        </>
      ) : (
        "Signing you in…"
      )}
    </div>
  );
}
function FileRoute() {
  const { id } = useParams();
  return <Workspace key={id} />;
}
/** Cluster mode requires a session with this server. */
function ClusterGate({ children }: { children: ReactNode }) {
  const { mode, locked } = useMode();
  const session = useNodeSession();
  const cluster = mode.kind === "cluster";
  useEffect(
    () =>
      cluster
        ? window.suiteleaf?.onMenu((action) => {
            if (action === "disconnect" && mode.kind === "cluster")
              void disconnectFromServer(mode.serverUrl).catch((e) =>
                window.alert(message(e)),
              );
          })
        : undefined,
    [cluster],
  );
  if (mode.kind !== "cluster" || session?.url === mode.serverUrl)
    return <>{children}</>;
  return (
    <SignInScreen
      serverUrl={mode.serverUrl}
      onDisconnect={
        locked || mode.kind !== "cluster"
          ? undefined
          : () => disconnectFromServer(mode.serverUrl)
      }
    />
  );
}
function signUpToken(): string | null {
  const match = /^\/sign-up\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export default function App() {
  const signUp = signUpToken();
  const [mode, setMode] = useState<ResolvedMode>();
  useEffect(() => {
    if (signUp) return;
    void finishSignOut();
    void resolveMode().then(setMode);
  }, [signUp]);
  if (signUp) return <SignUpPage token={signUp} />;
  if (!mode) return <div className="loading">Opening SuiteLeaf…</div>;
  return (
    <ModeContext.Provider value={mode}>
      <HashRouter>
        <AppTools />
        <Routes>
          <Route path="/public/:token" element={<PublicFileRoute />} />
          <Route
            path="/shared/:itemId"
            element={
              <ClusterGate>
                <SharedFileRoute />
              </ClusterGate>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/auth-complete" element={<AuthComplete />} />
          <Route
            path="/admin"
            element={
              <ClusterGate>
                <AdminScreen />
              </ClusterGate>
            }
          />
          <Route
            path="/templates"
            element={
              <ClusterGate>
                <TemplateGallery />
              </ClusterGate>
            }
          />
          <Route
            path="/file/:id/:slideId?"
            element={
              <ClusterGate>
                <FileRoute />
              </ClusterGate>
            }
          />
          <Route
            path="*"
            element={
              <ClusterGate>
                <Home />
              </ClusterGate>
            }
          />
        </Routes>
      </HashRouter>
    </ModeContext.Provider>
  );
}
