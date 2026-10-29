import { net, protocol } from "electron";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../renderer");
let registered = false;

/** Serve the built renderer at suiteleaf://app/. Safe to call more than once. */
export function registerAppProtocol() {
  if (registered) return;
  registered = true;
  protocol.handle("suiteleaf", (request) => {
    const url = new URL(request.url);
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (
      url.hostname !== "app" ||
      (!path.startsWith(root + sep) && path !== root)
    )
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path).toString());
  });
}
