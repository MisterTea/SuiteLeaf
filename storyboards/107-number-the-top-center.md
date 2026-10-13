# Number the top center

Who: Nia is finishing a short report. She wants the page number centered at the top of every page, in the header, not tucked into the bottom right corner.

Inspired by: Google Docs' Insert › Page numbers, which offers top left, top center, top right, bottom left, bottom center, and bottom right. Microsoft Word puts a centered number in the header.

## Scenes

1. Nia opens a document long enough for two pages and turns page numbers on. They appear at the bottom right, which is the current default.
2. In the same page setup she chooses Top center. The number leaves the bottom of the page and sits in the center of the top margin. The second page does the same. There is no second dialog.
3. She switches back to Bottom right. The number returns to the bottom right corner and is gone from the top.
4. She chooses Top center again, saves, returns home, and reopens. The number is still centered at the top.
5. She downloads a Word file. The header carries the centered page number. The footer does not also number the page.

## Google Workspace benchmark

- Docs offers six positions, but only from Insert › Page numbers, a separate menu from page setup.
- The canvas does not show which of the six is selected until that menu is open again.
- A header and a page number can collide, and Docs does not say so next to the position.

## Better than Google Workspace when

1. Top center is a choice in the same page setup as Bottom right, Bottom center, and Top right. There is no second dialog.
2. Choosing Top center puts the number in the horizontal center of the top margin on every numbered page, and removes it from the footer.
3. Bottom right, Bottom center, and Top right still do what they did. Switching away from Top center removes the top number.
4. The choice does not change the margins or how far the header sits from the edge.
5. Save and reopen keep Top center.
6. The downloaded Word file puts the page number in the header, centered, and does not also put a page number in the footer.
7. A one-page document shows the number centered at the top as soon as Top center is chosen, before the second page exists.

## Success

- Nia centers the page number at the top from page setup, and Word keeps it in the header.

## Gaps

- `PageNumberPosition` in `packages/core/src/document-layout.ts` is only `bottom-right`, `bottom-center`, and `top-right`.
- Page setup in `apps/web/src/editors/page-setup.tsx` lists Bottom center and Top right. It has no Top center.
