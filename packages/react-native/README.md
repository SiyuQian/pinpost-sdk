# @pinpost/react-native

`PinpostProvider`, `usePinpost()` and a default `<FeedbackWidget/>` (Modal bottom sheet)
built on core React Native components plus `lucide-react-native` icons. The icons render
through `react-native-svg`, a native module and a required peer dependency.

## Install

Bare React Native:

```sh
npm install @pinpost/react-native react-native-svg
cd ios && pod install   # Android autolinks
```

Expo:

```sh
npx expo install react-native-svg
npm install @pinpost/react-native
```

Expo Go already includes `react-native-svg`; a development build needs a rebuild after adding it.

Peer ranges: `react >=18`, `react-native >=0.72`, `react-native-svg >=13`.

Attachments: the widget has no image picker. To attach files, use the
headless API — `usePinpost().client.uploadAttachment({ name, mimeType, data })` then pass
the returned id in `submit({ ..., attachment_ids: [id] })`.
