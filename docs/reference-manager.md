# Reference manager

A reference library is fetched only when the person allowed it, the computer is online, and the address is https. The caller supplies the fetch. This module does not open a connection by itself.

If the connection is not allowed, or the computer is offline, the fetch is not called and the saved sources stay. An address with a username or password is refused, and that secret is not in the message. A failed answer whose body contains `token=secret-value` keeps the saved sources, and the message does not contain `secret-value`.

An allowed fetch of a BibTeX article adds `Rosa2020` beside the saved book `kept`. The list passed in is not changed.

The citation panel has Allow reference manager, an address field, and Fetch library. Fetch stays disabled until the box is checked. The panel uses the browser's online state and `fetch`. The panel was not opened in the browser.
