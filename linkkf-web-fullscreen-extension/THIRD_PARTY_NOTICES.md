# Third-party notices

## Picture-in-Picture Chrome Extension

The Picture-in-Picture feature was implemented with reference to the
GoogleChromeLabs Picture-in-Picture Chrome Extension:

https://github.com/GoogleChromeLabs/picture-in-picture-chrome-extension

Copyright 2018 Google LLC.

The referenced project is licensed under the Apache License, Version 2.0:

https://www.apache.org/licenses/LICENSE-2.0

This Linkkf-specific implementation was changed to:

- run only on the Linkkf player and its current embedded video host;
- place a PIP control directly in the ArtPlayer controller;
- track PIP entry and exit state in the inserted control; and
- coexist with the extension's web-fullscreen behavior.

