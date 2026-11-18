// Replaces packages/supermail/src/router/index.ts when SuiteMail is embedded
// in SuiteLeaf (see ./vite.ts). Memory history keeps SuiteMail's routes out of
// SuiteLeaf's URL hash.
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@supermail/router/routeTree";

export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/mail/inbox"] }),
  defaultPreload: false,
});
