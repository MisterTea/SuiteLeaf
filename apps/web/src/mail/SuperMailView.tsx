import { lazy, Suspense } from "react";

const SuperMailApp = lazy(() => import("@supermail/App"));

export function SuperMailView() {
  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <div className="text-sm font-medium">Loading SuperMail...</div>
          </div>
        }
      >
        <SuperMailApp />
      </Suspense>
    </div>
  );
}
