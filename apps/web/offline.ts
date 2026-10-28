import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** A published update replaces the previous cache and reloads open tabs. Pages come from the network so an open demo is not stuck on the previous scripts. Fonts are cached the first time a page uses them. */
export function serviceWorkerSource(version: string, paths: string[]) {
  return `const PREFIX='suiteleaf-'+new URL(self.registration.scope).pathname+'::';const CACHE=PREFIX+'-${version}';const FILES=${JSON.stringify(paths)};self.addEventListener('install',event=>event.waitUntil(Promise.all([self.skipWaiting(),caches.open(CACHE).then(cache=>cache.addAll(FILES))])));self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();const stale=keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE);await Promise.all(stale.map(k=>caches.delete(k)));await self.clients.claim();if(!stale.length)return;const windows=await self.clients.matchAll({type:'window'});await Promise.all(windows.map(client=>client.navigate(client.url)));})()));self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith((async()=>{const cache=await caches.open(CACHE);if(event.request.mode==='navigate'){try{const fresh=await fetch(event.request);void cache.put(event.request,fresh.clone());return fresh;}catch(error){return (await cache.match(event.request,{ignoreVary:true}))||(await cache.match('./'))||Response.error();}}const cached=await cache.match(event.request,{ignoreVary:true});if(cached)return cached;const fresh=await fetch(event.request);if(fresh.ok&&new URL(event.request.url).pathname.endsWith('.woff2'))void cache.put(event.request,fresh.clone());return fresh;})());});`;
}

export type PrecacheEntry = {
  fileName: string;
  type: string;
  code?: string;
  facadeModuleId?: string | null;
};

/**
 * Vite deletes the one-byte JavaScript file it creates for a CSS-only dynamic
 * import. Caching that name makes installation fail, so the app never comes
 * back offline. Fonts are left out: there are hundreds of Office equivalents,
 * and the worker caches each one when a page first uses it.
 */
export function precachePaths(entries: PrecacheEntry[]) {
  const files = entries
    .filter((entry) => !droppedStylesheetStub(entry) && !entry.fileName.endsWith(".woff2"))
    .map((entry) => `./${entry.fileName}`);
  return ["./", "./icon.svg", "./THIRD_PARTY_NOTICES.txt", ...files];
}

function droppedStylesheetStub(entry: PrecacheEntry) {
  return (
    entry.type === "chunk" &&
    (entry.facadeModuleId ?? "").endsWith(".css") &&
    (entry.code ?? "").trim() === ""
  );
}

export function offline(): Plugin {
  return {
    name: "suiteleaf-offline",
    apply: "build",
    generateBundle(_options, bundle) {
      const paths = precachePaths(
        Object.values(bundle).map((item) =>
          item.type === "chunk"
            ? {
                fileName: item.fileName,
                type: item.type,
                code: item.code,
                facadeModuleId: item.facadeModuleId,
              }
            : { fileName: item.fileName, type: item.type },
        ),
      );
      const version = createHash("sha256")
        .update(JSON.stringify(bundle))
        .digest("hex")
        .slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource(version, paths),
      });
    },
  };
}
