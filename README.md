# Pinpost SDK

MIT-licensed TypeScript clients for the [Pinpost feedback server](https://github.com/SiyuQian/pinpost).

| Package | Use |
| --- | --- |
| `@pinpost/core` | Headless client for submitting feedback, uploading attachments, and fetching project config. |
| `@pinpost/react` | Provider, hooks, and a ready-to-use feedback widget for React. |
| [`@pinpost/react-native`](packages/react-native/README.md) | Provider, hooks, and a native modal widget for React Native. |

## Use the SDK

Once the packages are available on npm, install the package that matches your app.
Get your project's write key from the Pinpost admin console, and pass the URL of your Pinpost server as `apiUrl`.

### Headless client

```sh
npm install @pinpost/core
```

```ts
import { createClient } from "@pinpost/core";

const pinpost = createClient({
  apiUrl: "https://feedback.example.com",
  writeKey: "your-project-write-key",
});

await pinpost.submit({ type: "bug", message: "The save button is disabled." });
```

### React

```sh
npm install @pinpost/react
```

```tsx
import { FeedbackWidget, PinpostProvider } from "@pinpost/react";

export function App() {
  return (
    <PinpostProvider apiUrl="https://feedback.example.com" writeKey="your-project-write-key">
      <FeedbackWidget />
    </PinpostProvider>
  );
}
```

For Expo or bare React Native, follow the [React Native setup guide](packages/react-native/README.md).

## Development

Use Node.js 22 or later.

```sh
npm ci
npm test
```

To run the integration test, start a local Pinpost server with PostgreSQL,
S3-compatible storage, and the demo tenant enabled. Follow the
[server quick start](https://github.com/SiyuQian/pinpost#quick-start), then run
`npm run test:integration` after building the SDK. The test defaults to
`http://localhost:8787` and the seeded demo write key. Override them with
`PINPOST_API_URL` and `PINPOST_WRITE_KEY` for a different local instance.

CI runs the same integration test against the server commit pinned in
[the workflow](.github/workflows/ci.yml). Update that pin when the SDK needs
a newer server. The server's [OpenAPI spec](https://github.com/SiyuQian/pinpost/blob/main/api/openapi.yaml)
defines the HTTP API.

## Releases

The packages are versioned and released from this workspace. Keep each UI
package's exact `@pinpost/core` dependency in sync with the core version it
uses, and commit the updated lockfile with any version changes.

Run `npm ci` and `npm test`, confirm the compatibility check passed for the
release commit, and inspect the packages with `npm pack --workspaces --dry-run`.
Use an npm account with publish access to the `@pinpost` scope. Publish new
versions of the packages being released, starting with core when it changes.

```sh
npm publish --workspace @pinpost/core --access public
npm publish --workspace @pinpost/react --access public
npm publish --workspace @pinpost/react-native --access public
```

## Contributing

File SDK issues and pull requests here. Contributions are covered by the
[Pinpost Contributor License Agreement](https://github.com/SiyuQian/pinpost/blob/main/CLA.md).

## License

[MIT](LICENSE)
