# @pinpost/react-native

`PinpostProvider`, `usePinpost()` and a default `<FeedbackWidget/>` (Modal bottom sheet)
built only on core React Native components. No native modules.

Attachments: the widget has no image picker (no native deps). To attach files, use the
headless API — `usePinpost().client.uploadAttachment({ name, mimeType, data })` then pass
the returned id in `submit({ ..., attachment_ids: [id] })`.
