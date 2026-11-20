# Agent Instructions

This is the public SDK repository. See [README.md](README.md) for development, tests, and releases.

## Public repository privacy

- Keep all real third-party product names, brands, and integration details out of this repository and its contributions.
- Keep customer names, domains, repository links, account IDs, credentials, and real payloads in the relevant private workspace.
- Use synthetic data in code examples, tests, fixtures, screenshots, and logs. Use reserved domains such as `example.test`.
- Store product-specific integration plans and evidence in the relevant private workspace.
- Use the SDK's own public identifiers. Use exact names for dependencies, tools, and standards when the SDK requires them.

## Review before publishing

1. Inspect the full diff, including filenames and new files.
2. Inspect every outgoing commit and its message. Remove real product information from the commit that introduced it.
3. Inspect branch and tag names, pull request titles and descriptions, and release notes for real product information.
4. Inspect shared logs, screenshots, and package contents. Use `npm pack --workspaces --dry-run` to list package files.
