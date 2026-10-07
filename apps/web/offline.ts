import { createHash } from "node:crypto";
import type { Plugin } from "vite";
export function offline(): Plugin {
  return {
    name: "suiteleaf-offline",
    apply: "build",
    generateBundle(_options, bundle) {
      const paths = [
        "./",
        "./icon.svg",
        "./THIRD_PARTY_NOTICES.txt",
        ...Object.keys(bundle).map((p) => `./${p}`),
      ];
      const version = createHash("sha256")
        .update(JSON.stringify(bundle))
        .digest("hex")
        .slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const PREFIX='suiteleaf-'+new URL(self.registration.scope).pathname+'::';const CACHE=PREFIX+'-${version}';const FILES=${JSON.stringify(paths)};self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request,{ignoreVary:true});if(cached)return cached;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return (await cache.match('./'))||Response.error();throw error;}}));});`,
      });
    },
  };
}
