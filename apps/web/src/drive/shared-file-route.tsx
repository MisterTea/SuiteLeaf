import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  type To,
  type NavigateOptions,
} from "react-router-dom";
import { drive } from "../node-client";
import { openFromDrive } from "./drive-files";
import { rememberDriveFolder } from "./DriveBrowser";
import { message } from "../error-message";

/** Resolve a server item, rather than assuming its ID is a local cache ID. */
export function SharedFileRoute() {
  const { itemId = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    void drive
      .get(itemId)
      .then(async (item) => {
        if (!active) return;
        if (item.kind === "folder") {
          rememberDriveFolder(item.id, item.name);
          void navigate("/", { replace: true });
        } else {
          await openFromDrive(
            item,
            (to: To | number, options?: NavigateOptions) => {
              if (active)
                return typeof to === "number"
                  ? navigate(to)
                  : navigate(to, options);
            },
          );
        }
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [itemId, navigate]);
  return (
    <main className="loading">
      {error ? (
        <>
          <h1>Could not open shared file</h1>
          <p role="alert">{error}</p>
          <Link to="/">Return to files</Link>
        </>
      ) : (
        "Opening shared file…"
      )}
    </main>
  );
}
