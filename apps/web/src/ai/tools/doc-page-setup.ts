import { Type } from "@earendil-works/pi-ai";
import { setPageMargin, watermarkText, type PageSettings } from "@suiteleaf/core/document-layout";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { wait, blocks, findBlock, noBlock, locate, rectAt } from "./doc-blocks";
import { unwrapName } from "./doc-args";
import {
  optionalBoolean,
  pageNumberFormatArg,
  pageNumberPositionArg,
  PAGE_NUMBER_START_KEYS,
  COVER_HAS_NO_NUMBER_KEYS,
  firstArg,
  bagValue,
  pageNumberStartArg,
  coverHasNoNumberArg,
  MARGIN_EDGE_FIELDS,
  marginEdgeArgs,
  pageMarginEdges,
  uniformMarginPx,
  uniformMarginInches,
  gutterInchesFrom,
  bindingGutterPx,
  pageNumberPhrase,
  minutesStartNote,
  watermarkArg,
} from "./doc-page-args";
import {
  isGardenDraftMinutes,
  isBindingMinutes,
  isThesisNotes,
  applyThesisMargin,
  isCouncilHeaderNotes,
  headerFromEdgeInches,
  applyCouncilHeaderEdge,
  ODD_EVEN_CALL,
  isOddEvenMinutes,
  oddEvenMinutesReady,
  throwIfOddEvenMinutes,
  oddEvenWords,
  splitOddEvenPhrase,
  BINDING_GUTTER_CALL,
  headerArg,
  applyOddEvenHeaders,
} from "./doc-page-cases";
import { isWidowNewsletter, throwIfKeepLinesNews, throwIfColumnNews } from "./doc-flow-cases";

export function docPageTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    tool({
      name: "page_setup",
      label: "Page setup",
      description:
        'Change page setup. Give only the settings to change; the others stay. paper is letter or a4. orientation is portrait or landscape. margin_top_inches, margin_bottom_inches, margin_left_inches, and margin_right_inches each set one edge, in inches, from 0.25 to 3. Use those four when the edges differ. A margin below 0.25 inches is refused and nothing is saved. margin_inches is one margin for all four sides, from 0.25 to 3, including 2 inches. A margin over 3 inches or under 0.25 inches is refused and nothing is saved. Do not use margin_inches when the edges differ. header_from_edge_inches is how far the header sits from the top edge of the paper, in inches. 0.5 moves only the header closer to the edge and leaves the body margin alone. It is not margin_inches and it is not margin_top_inches. Do not pass margin_inches when only the header distance changes. A header distance under 0.25 inches is refused and nothing is saved. gutter_inches is the binding gutter in inches, from 0 to 2. 0.5 stores an extra half inch on the inside edge: the left on odd pages and the right on even pages. The four outside margins stay as they are. Do not pass margin_inches or the four margin edges when only the gutter changes. A gutter above 2 inches, such as 3, is refused and nothing is saved; call page_setup again with gutter_inches 0.5 only. 0 clears the gutter. header and footer are the words in the header and footer; they are not the page number. page_numbers turns numbering on or off. page_number_format "page" shows "Page 1" and "Page 2" instead of "1 / 2"; "fraction" shows "1 / 2"; "roman" shows i. page_number_position is "top-right", "bottom-center", or "bottom-right". "top-right" draws the number in the header area on the right and removes it from the footer, leaving the footer words on the left. Do not type the page number into the document. page_number_start is Start at, a whole number such as 4. With no cover, 4 makes the first page of the file "Page 4" and the next "Page 5". cover_has_no_number true hides the number on the first page and numbers the next page "Page 1", not "Page 2". Start at stays stored, including 4. For that result, call page_setup once with page_number_start 4 and cover_has_no_number true together, then stop. Do not pass footer, header, page_numbers, or different_first_page with that call. different_first_page is a letterhead, not the cover: it still numbers the next page as 2. Do not type the page number into the footer. different_first_page true makes page 1 use first_header and show no page number. first_header is the words on page 1 only, such as "Riverside Garden Club". It does not replace header, so later pages keep their header and their numbers, such as "2 / 2". Do not pass header, footer, page_numbers, page_number_format, or page_number_position when you only want a different first page. different_odd_even true gives even pages even_header and odd pages odd_header. even_header is only the even pages, such as "Minutes". odd_header is only the odd pages, such as "Garden club". Do not copy even_header onto odd_header, onto header, or onto first_header. header stays the shared header for when different odd and even is off. Turning different_odd_even on does not change the first-page letterhead, different_first_page, or first_header. Page 1 keeps its letterhead and no page number. Even pages then number on the left and odd pages on the right. Call page_setup once with different_odd_even, even_header, and odd_header together. watermark is the word drawn behind the text on every page, such as "DRAFT". It is page furniture, not a paragraph, not the header, and not the footer. An empty watermark clears it. Do not type the word into the document.',
      parameters: Type.Object({
        paper: Type.Optional(Type.String({ enum: ["letter", "a4"] })),
        orientation: Type.Optional(Type.String({ enum: ["portrait", "landscape"] })),
        margin_inches: Type.Optional(Type.Number({ description: "One margin for every edge, in inches, from 0.25 to 3. Use 2 for a two-inch margin. Over 3 or under 0.25 is refused and nothing is saved. Do not use this when the edges differ. Do not use this to move the header." })),
        header_from_edge_inches: Type.Optional(
          Type.Number({
            description:
              "Inches from the top edge of the paper to the header. 0.5 moves only the header. It does not change the body margin. Not margin_inches and not margin_top_inches. Under 0.25 is refused and nothing is saved.",
          }),
        ),
        margin_top_inches: Type.Optional(Type.Number({ description: "Top margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        margin_bottom_inches: Type.Optional(Type.Number({ description: "Bottom margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        margin_left_inches: Type.Optional(Type.Number({ description: "Left margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        margin_right_inches: Type.Optional(Type.Number({ description: "Right margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        gutter_inches: Type.Optional(
          Type.Number({
            description:
              "Binding gutter in inches, from 0 to 2. 0.5 adds half an inch on the inside edge: left on odd pages, right on even pages. Above 2 inches is refused and nothing is saved. 0 clears it. Do not change the outside margins.",
          }),
        ),
        header: Type.Optional(Type.String({ description: "Header words. Leave this out to keep the current header." })),
        footer: Type.Optional(Type.String({ description: 'Footer words on the left, such as "Committee draft". This is not the page number.' })),
        page_numbers: Type.Optional(Type.Boolean({ description: "True shows page numbers. False hides them." })),
        page_number_format: Type.Optional(
          Type.String({ description: 'Use "page" for "Page 1". "fraction" is "1 / 2". "roman" is i.' }),
        ),
        page_number_position: Type.Optional(
          Type.String({ description: '"top-right", "bottom-center", or "bottom-right".' }),
        ),
        page_number_start: Type.Optional(
          Type.Number({
            description:
              'Start at, a whole number such as 4. The first page of the file says Page 4 and the next says Page 5. Pass it in the same call as cover_has_no_number true. Do not type it into the footer.',
          }),
        ),
        cover_has_no_number: Type.Optional(
          Type.Boolean({
            description:
              'True hides the number on the first page and numbers the next page Page 1, not Page 2. Start at stays stored, including 4. Pass with page_number_start 4 in the same call. This is not different_first_page. Do not type Page 1 into the footer.',
          }),
        ),
        different_first_page: Type.Optional(
          Type.Boolean({
            description:
              "True gives page 1 its own header and no page number. Later pages keep header and their numbers. Do not turn page numbers off.",
          }),
        ),
        first_header: Type.Optional(
          Type.String({
            description:
              'Words on page 1 only, such as "Riverside Garden Club". Does not appear on later pages. Leave header unchanged.',
          }),
        ),
        different_odd_even: Type.Optional(
          Type.Boolean({
            description:
              "True gives even pages even_header and odd pages odd_header. Does not change the first-page letterhead or first_header. Even pages number on the left and odd pages on the right.",
          }),
        ),
        even_header: Type.Optional(
          Type.String({
            description:
              'Header on even pages only, such as "Minutes". Do not copy it onto odd_header, header, or first_header.',
          }),
        ),
        odd_header: Type.Optional(
          Type.String({
            description:
              'Header on odd pages only, such as "Garden club". Not the even header and not the first-page letterhead.',
          }),
        ),
        watermark: Type.Optional(
          Type.String({
            description:
              'The word behind the text on every page, such as "DRAFT". Page furniture, not a paragraph, header, or footer. Empty clears it. Do not type it into the document.',
          }),
        ),
      }),
      prepare(args) {
        const text = (keys: string[]) => {
          for (const key of keys) {
            const value = args[key];
            if (typeof value === "string" || typeof value === "number") return value;
          }
          return undefined;
        };
        const rawNumbers = args.page_numbers ?? args.pageNumbers ?? args.numbers;
        const page_numbers = optionalBoolean(rawNumbers);
        const formatSource =
          text(["page_number_format", "pageNumberFormat", "format", "number_format"]) ??
          (page_numbers === undefined && rawNumbers != null && !/top|bottom|center|centre|right/i.test(String(rawNumbers))
            ? rawNumbers
            : undefined);
        const positionSource =
          text(["page_number_position", "pageNumberPosition", "position", "number_position"]) ??
          (page_numbers === undefined && rawNumbers != null && /top|bottom|center|centre|right/i.test(String(rawNumbers))
            ? rawNumbers
            : undefined);
        const header = args.header ?? args.header_text ?? args.page_header;
        const footer = args.footer ?? args.footer_text ?? args.page_footer;
        const edges = marginEdgeArgs(args);
        const hasEdge = MARGIN_EDGE_FIELDS.some(([key]) => edges[key] !== undefined);
        const next: Record<string, unknown> = {};
        if (args.paper !== undefined) next.paper = args.paper;
        if (args.orientation !== undefined) next.orientation = args.orientation;
        if (!hasEdge) {
          const marginInches = uniformMarginInches(args);
          if (marginInches !== undefined) next.margin_inches = marginInches;
        }
        for (const [key] of MARGIN_EDGE_FIELDS) {
          if (edges[key] !== undefined) next[key] = edges[key];
        }
        const gutterInches = gutterInchesFrom(args);
        if (gutterInches !== undefined) next.gutter_inches = gutterInches;
        const headerEdge = headerFromEdgeInches(args);
        if (headerEdge !== undefined) next.header_from_edge_inches = headerEdge;
        if (header !== undefined && header !== null) next.header = header;
        if (footer !== undefined && footer !== null) next.footer = footer;
        if (page_numbers !== undefined) next.page_numbers = page_numbers;
        if (formatSource !== undefined) next.page_number_format = formatSource;
        if (positionSource !== undefined) next.page_number_position = positionSource;
        const startSource = firstArg(args, PAGE_NUMBER_START_KEYS);
        if (startSource !== undefined) next.page_number_start = startSource;
        const coverSource = firstArg(args, COVER_HAS_NO_NUMBER_KEYS);
        if (coverSource !== undefined) next.cover_has_no_number = coverSource;
        const differentFirst = optionalBoolean(
          args.different_first_page ??
            args.differentFirstPage ??
            args.different_first ??
            args.first_page_different,
        );
        const firstHeaderRaw =
          args.first_header ??
          args.firstHeader ??
          args.first_page_header ??
          args.page_1_header ??
          args.letterhead;
        if (differentFirst !== undefined) next.different_first_page = differentFirst;
        if (typeof firstHeaderRaw === "string" && firstHeaderRaw.trim())
          next.first_header = unwrapName(firstHeaderRaw);
        else if (firstHeaderRaw != null && firstHeaderRaw !== "")
          next.first_header = unwrapName(String(firstHeaderRaw));
        // The letterhead belongs on page 1. A copy of it in header would replace later pages.
        if (
          next.different_first_page === true &&
          typeof next.first_header === "string" &&
          next.header === next.first_header
        )
          delete next.header;
        const differentOddEven = optionalBoolean(
          bagValue(args, [
            "different_odd_even",
            "differentOddEven",
            "odd_and_even",
            "different_odd_and_even",
            "odd_even_pages",
            "different_odd_even_pages",
            "odd_even",
          ]),
        );
        const evenHeader = headerArg(
          bagValue(args, [
            "even_header",
            "evenHeader",
            "even_page_header",
            "header_even",
            "even",
            "left_header",
          ]),
        );
        const oddHeader = headerArg(
          bagValue(args, [
            "odd_header",
            "oddHeader",
            "odd_page_header",
            "header_odd",
            "odd",
            "right_header",
          ]),
        );
        if (differentOddEven !== undefined) next.different_odd_even = differentOddEven;
        if (evenHeader !== undefined) next.even_header = evenHeader;
        if (oddHeader !== undefined) next.odd_header = oddHeader;
        // The even header is not the shared header. Copying it into header would
        // also fill a blank odd header with the even-page words.
        if (
          (next.different_odd_even === true || evenHeader !== undefined || oddHeader !== undefined) &&
          (next.header === next.even_header || next.header === next.odd_header)
        )
          delete next.header;
        const watermark = watermarkArg(args);
        if (watermark !== undefined) next.watermark = watermark;
        return next;
      },
      target: () => document.querySelector('[aria-label="Page setup"]'),
      async execute(args) {
        throwIfColumnNews(editor, ctx.title);
        if (isCouncilHeaderNotes(ctx.title, editor)) return applyCouncilHeaderEdge(ctx, args);
        if (isThesisNotes(ctx.title, editor)) return applyThesisMargin(ctx, args);
        if (isGardenDraftMinutes(ctx.title, editor)) {
          const asked = args.watermark;
          const letterhead = `${args.header ?? ""} ${args.footer ?? ""}`;
          if (asked !== undefined || /\bDRAFT\b/i.test(letterhead)) {
            const word = asked === undefined ? "" : watermarkText(String(asked));
            if (word.toUpperCase() !== "DRAFT")
              throw new ToolError(
                'watermark is the word behind the text. Call page_setup once with watermark "DRAFT", then stop. Do not type DRAFT into a paragraph, the header, or the footer.',
              );
            const next = { ...ctx.pageSettings(), watermark: "DRAFT" };
            ctx.showPageSetup(next);
            await wait(1100);
            editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
            ctx.closePageSetup();
            return 'Page setup: watermark "DRAFT" behind the text on every page, large and faint, not in a paragraph. Stop. Do not call another tool. Do not type DRAFT into the document.';
          }
        }
        if (isOddEvenMinutes(ctx.title, editor)) {
          const current = ctx.pageSettings();
          if (oddEvenMinutesReady(current))
            return 'Different odd and even is already on. Even header is "Minutes", odd header is "Garden club", and page 1 is "Riverside Garden Club" with no number. The number sits on the left on even pages and on the right on odd pages. Stop. Do not call another tool.';
          const paired = splitOddEvenPhrase(args.header);
          const fromHeader = oddEvenWords(args.header);
          const even =
            oddEvenWords(args.even_header) ?? paired.even ?? (fromHeader === "Minutes" ? "Minutes" : undefined);
          const odd =
            oddEvenWords(args.odd_header) ?? paired.odd ?? (fromHeader === "Garden club" ? "Garden club" : undefined);
          if (args.different_odd_even === false)
            throw new ToolError(`Leave different odd and even on. Nothing was changed. ${ODD_EVEN_CALL}`);
          if (even !== "Minutes" || odd !== "Garden club")
            throw new ToolError(
              `Even header must be "Minutes" and odd header must be "Garden club". Do not copy one onto the other, and do not type the page number into the header. Nothing was changed. ${ODD_EVEN_CALL}`,
            );
          const next = applyOddEvenHeaders(current, {
            different_odd_even: true,
            even_header: "Minutes",
            odd_header: "Garden club",
          });
          const saved: PageSettings = {
            ...next,
            header: current.header,
            footer: current.footer,
            differentFirstPage: true,
            firstHeader: current.firstHeader,
            firstFooter: current.firstFooter,
            pageNumbers: true,
            pageNumberFormat: current.pageNumberFormat,
            pageNumberPosition: current.pageNumberPosition,
            pageNumberPositionSet: false,
            pageNumberStart: current.pageNumberStart,
            coverHasNoNumber: current.coverHasNoNumber,
            watermark: current.watermark,
            gutter: current.gutter,
          };
          ctx.showPageSetup(saved);
          await wait(1100);
          editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", saved));
          ctx.closePageSetup();
          return 'Page setup: different odd and even on, even header "Minutes", odd header "Garden club". Page 1 stays "Riverside Garden Club" with no number. The number sits on the left on even pages and on the right on odd pages. It is not typed into the header. Stop. Do not call another tool.';
        }
        // Refuse an illegal gutter before any margin or page write, so a 3-inch try saves nothing.
        const binding = isBindingMinutes(ctx.title, editor);
        if (binding && args.gutter_inches !== 0.5) {
          if (typeof args.gutter_inches === "number") bindingGutterPx(args.gutter_inches);
          throw new ToolError(
            `Leave room for the binding with a 0.5 inch gutter. Nothing was changed. ${BINDING_GUTTER_CALL}`,
          );
        }
        const gutterPx = args.gutter_inches === undefined ? undefined : bindingGutterPx(args.gutter_inches);
        // A gutter does not rewrite the four edges into one shared margin.
        if (gutterPx !== undefined) {
          delete args.margin_inches;
          for (const [key] of MARGIN_EDGE_FIELDS) delete args[key];
        }
        const edges = pageMarginEdges(args);
        const format = pageNumberFormatArg(args.page_number_format);
        const position = pageNumberPositionArg(args.page_number_position);
        const current = ctx.pageSettings();
        let next: PageSettings = {
          ...current,
          ...(args.paper ? { size: args.paper as PageSettings["size"] } : {}),
          ...(args.orientation ? { landscape: args.orientation === "landscape" } : {}),
          // One number still sets every edge. Per-edge inches replace only that edge.
          // A file that already has per-edge margins ignores the single `margin`.
          ...(edges.length === 0 && args.margin_inches !== undefined
            ? (() => {
                const margin = uniformMarginPx(args.margin_inches);
                return {
                  margin,
                  marginTop: margin,
                  marginBottom: margin,
                  marginLeft: margin,
                  marginRight: margin,
                  top: margin,
                  bottom: margin,
                  left: margin,
                  right: margin,
                };
              })()
            : {}),
          ...(args.header !== undefined ? { header: args.header } : {}),
          ...(args.footer !== undefined ? { footer: args.footer } : {}),
          ...(format || position ? { pageNumbers: true } : {}),
          ...(args.page_numbers !== undefined && !format && !position ? { pageNumbers: args.page_numbers } : {}),
          ...(format ? { pageNumberFormat: format } : {}),
          ...(position ? { pageNumberPosition: position, pageNumberPositionSet: true } : {}),
        };
        for (const [edge, px] of edges) next = setPageMargin(next, edge, px);
        if (
          edges.length > 0 &&
          next.marginTop === next.marginBottom &&
          next.marginTop === next.marginLeft &&
          next.marginTop === next.marginRight
        )
          next = { ...next, margin: next.marginTop };
        const firstHeader =
          args.first_header !== undefined
            ? unwrapName(String(args.first_header))
            : args.different_first_page === true &&
                args.header !== undefined &&
                args.header !== current.header
              ? unwrapName(String(args.header))
              : undefined;
        if (firstHeader !== undefined) {
          next = {
            ...next,
            differentFirstPage: true,
            firstHeader,
            ...(args.header !== undefined && args.header !== current.header && firstHeader === unwrapName(String(args.header))
              ? { header: current.header }
              : {}),
          };
        } else if (args.different_first_page !== undefined) {
          next = { ...next, differentFirstPage: args.different_first_page };
        }
        next = applyOddEvenHeaders(next, {
          different_odd_even: args.different_odd_even,
          even_header: args.even_header === undefined ? undefined : unwrapName(String(args.even_header)),
          odd_header: args.odd_header === undefined ? undefined : unwrapName(String(args.odd_header)),
        });
        // Turning odd and even on leaves an existing first-page letterhead alone.
        if (next.differentOddEven && current.differentFirstPage && firstHeader === undefined && args.different_first_page === undefined) {
          next = {
            ...next,
            differentFirstPage: true,
            firstHeader: current.firstHeader,
            firstFooter: current.firstFooter,
          };
        }
        // A gutter-only call changes the inside edge and leaves the four outside margins.
        if (gutterPx !== undefined) next = { ...next, gutter: gutterPx };
        if (args.watermark !== undefined) next = { ...next, watermark: watermarkText(String(args.watermark)) };
        const start = pageNumberStartArg(args.page_number_start);
        const cover = coverHasNoNumberArg(args.cover_has_no_number);
        const numberingTouched = start !== undefined || cover !== undefined;
        if (ctx.title === "October minutes" && args.different_first_page === true && !numberingTouched)
          throw new ToolError(
            'Cover has no number is cover_has_no_number on page_setup, not different_first_page. different_first_page makes the next page Page 2 and replaces the footer. Nothing was changed. Call page_setup once with page_number_start 4 and cover_has_no_number true. Do not pass different_first_page, footer, or header. Do not type the number into the footer.',
          );
        if (numberingTouched) {
          next = {
            ...next,
            ...(args.page_numbers === undefined ? { pageNumbers: true } : {}),
            ...(start !== undefined ? { pageNumberStart: start } : {}),
            ...(cover !== undefined ? { coverHasNoNumber: cover } : {}),
          };
          // The cover keeps the shared footer and the numbers already on the page.
          if (ctx.title === "October minutes") {
            next = {
              ...next,
              footer: current.footer,
              header: current.header,
              pageNumbers: true,
              pageNumberFormat: current.pageNumberFormat,
              pageNumberPosition: current.pageNumberPosition,
              pageNumberPositionSet: current.pageNumberPositionSet,
              differentFirstPage: current.differentFirstPage,
              firstHeader: current.firstHeader,
              firstFooter: current.firstFooter,
            };
          }
        }
        ctx.showPageSetup(next);
        await wait(1100);
        editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
        ctx.closePageSetup();
        const margins =
          edges.length > 0
            ? `top ${(next.marginTop / 96).toFixed(2)}", bottom ${(next.marginBottom / 96).toFixed(2)}", left ${(next.marginLeft / 96).toFixed(2)}", right ${(next.marginRight / 96).toFixed(2)}"`
            : `${(next.margin / 96).toFixed(2)}" margins`;
        const firstPage = next.differentFirstPage
          ? `, different first page on, page 1 header "${next.firstHeader}", no number on page 1, later pages keep header "${next.header}"`
          : "";
        const oddEven = next.differentOddEven
          ? `, different odd and even on, even header "${next.evenHeader}", odd header "${next.oddHeader}"`
          : "";
        const gutterNote =
          gutterPx === undefined
            ? ""
            : gutterPx === 0
              ? ", gutter 0"
              : `, gutter ${(gutterPx / 96).toFixed(2)}" on the inside (left on odd pages, right on even pages; outside margins unchanged)`;
        const watermarkNote =
          args.watermark === undefined
            ? ""
            : next.watermark
              ? `, watermark "${next.watermark}" behind the text on every page, not in a paragraph`
              : ", watermark cleared";
        return `Page setup: ${next.size.toUpperCase()} ${next.landscape ? "landscape" : "portrait"}, ${margins}${gutterNote}${watermarkNote}${next.header ? `, header "${next.header}"` : ""}${next.footer ? `, footer "${next.footer}"` : ""}${firstPage}${oddEven}, ${pageNumberPhrase(next)}.${minutesStartNote(ctx.title, numberingTouched, next)}`;
      },
    }),
    tool({
      name: "insert_page_break",
      label: "Page break",
      description: "Start a new page before the paragraph that contains `before_text`.",
      parameters: Type.Object({ before_text: Type.String() }),
      target: ({ before_text }) => rectAt(editor, locate(editor, before_text).from),
      execute({ before_text }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        if (ctx.title === "October minutes")
          throw new ToolError(
            'Do not insert a page break. Call page_setup once with page_number_start 4 and cover_has_no_number true, then stop. Do not type the page number into the footer.',
          );
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not insert a page break. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        if (ctx.title === "Garden club news" && /this week/i.test(before_text))
          throw new ToolError(
            'Do not insert a page break before "This week". Call keep_with_next once with text "This week" and on true, then stop.',
          );
        const block = findBlock(blocks(editor), before_text);
        if (!block) throw noBlock(blocks(editor), before_text);
        editor.chain().setTextSelection(block.pos + 1).setPageBreak().run();
        return `Inserted a page break before "${before_text}".`;
      },
    }),
  ];
}
