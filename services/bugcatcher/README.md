# Bugcatcher

Cloudflare Worker that receives in-app bug reports and feature requests and files them as issues in the private `MisterTea/SuiteLeaf-issues` repo, uploading screenshots directly to GitHub's issue attachments storage.

## Endpoint

- `POST /report`: JSON `{ type: "bug" | "feature", text: string, screenshot?: dataURL, context?: string }`. Returns `{ success, number }`.

## Deploy

```sh
cd services/bugcatcher
npx wrangler login
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: SuiteLeaf-issues only, Issues read/write
npx wrangler deploy
```

Then set the endpoint in the app with `VITE_BUGCATCHER_URL` (defaults to the workers.dev URL in `apps/web/src/feedback/feedback-service.ts`).
