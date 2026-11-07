# Casting slides

In the web frontend, open the arrow beside **Slideshow** and select **Cast…**.
Choose a Google Cast TV or receiver on the same Wi-Fi network. SuiteLeaf opens
presenter view locally and sends the current slide to the TV. Navigation,
click reveals, and black/white blank screens follow the presenter. Speaker
notes, comments, and other slides are excluded from each transfer.
Use **Stop casting** or exit the slideshow to stop the receiver. Closing the
editor also stops its session. Native desktop builds direct users to Chrome.

## Configure an installation

1. Host the web build over HTTPS, including `cast-receiver.html` alongside
   `index.html`. The TV must be able to reach that URL without signing in.
2. In the [Google Cast Developer Console](https://cast.google.com/publish/),
   register a **Custom Receiver** with that receiver page's full HTTPS URL
   (for example, `https://example.com/SuiteLeaf/cast-receiver.html`).
3. Set `VITE_SUITELEAF_CAST_APP_ID` to the assigned application ID when building
   the web frontend. For local development, use `apps/web/.env.local`.
   For the GitHub Pages demo, set the repository Actions variable with the
   same name. This ID is public configuration, not a secret.
4. Register test devices in the console while the receiver is unpublished;
   publish the receiver when it is ready for general use.

The menu explains when casting is unconfigured, insecure, or unavailable in
the browser. Google's sender SDK requires a compatible browser; Chrome on iOS
is unsupported. SDK loading failures and device cancellation do not start a
slideshow. Real device discovery and rendering require testing with Cast
hardware; the automated tests use SDK and receiver stand-ins.

The receiver uses the same slide renderer and reveal rules as the local show,
including a rendered MARP page where applicable. Browser-local blob assets are
embedded before transfer, and messages are chunked below Cast's 64 KiB limit.
Large frames above roughly 36 MiB are rejected with an error. This sends slide
state, not a screen or media stream; local audio/video playback and seeking are
not synchronized to the TV. External assets must be reachable by the receiver.

SDK references: [Web sender integration](https://developers.google.com/cast/docs/web_sender/integrate)
and [custom receiver messages](https://developers.google.com/cast/docs/web_receiver/core_features#custom-messages).
