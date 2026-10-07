# Contributing

Use Node 24 and npm; commit the lockfile alongside dependency changes. Run typecheck, lint, unit tests, production builds, and the affected Playwright flows before submitting changes.

Keep browser and Electron renderer code shared. Add platform behavior through the core storage/bridge contracts rather than importing Node or Electron into React components. Keep dependency versions aligned within the Tiptap and Univer package families, and use permissively licensed production dependencies without required paid services. Regenerate third-party notices after changing dependencies.

Add file-format migrations for incompatible schema changes. Test failed saves and imports, not just successful rendering. Protect existing user data and retain recovery drafts when persistence fails.

Reference books and research downloads are local-only materials. Do not add them or copied book illustrations/text to source or release artifacts. Use original fixtures and examples for tests and documentation.
