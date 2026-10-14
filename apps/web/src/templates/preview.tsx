import type { CSSProperties } from "react";
import type { DocFile, JsonNode, SheetFile, SlideFile, SuiteFile } from "@suiteleaf/core";
import { previewGrid, type GridCell } from "./formulas";

function marks(node: JsonNode) {
  const types = new Set(node.marks?.map((mark) => mark.type));
  return {
    fontWeight: types.has("bold") ? 700 : undefined,
    fontStyle: types.has("italic") ? "italic" : undefined,
    textDecoration: types.has("underline") ? "underline" : undefined,
  };
}

function Inline({ node }: { node: JsonNode }) {
  if (node.type === "text") return <span style={marks(node)}>{node.text}</span>;
  return <>{node.content?.map((child, i) => <Inline key={i} node={child} />)}</>;
}

function Block({ node }: { node: JsonNode }) {
  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 1);
    const Tag = (level === 1 ? "h3" : "h4") as "h3" | "h4";
    return (
      <Tag>
        <Inline node={node} />
      </Tag>
    );
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const Tag = node.type === "bulletList" ? "ul" : "ol";
    return (
      <Tag>
        {node.content?.map((item, i) => (
          <li key={i}>
            {item.content?.map((child, j) => (
              <Inline key={j} node={child} />
            ))}
          </li>
        ))}
      </Tag>
    );
  }
  if (node.type === "image") {
    const src = String(node.attrs?.src ?? "");
    return src ? <img src={src} alt="" /> : null;
  }
  return (
    <p>
      <Inline node={node} />
    </p>
  );
}

function DocPreview({ file }: { file: DocFile }) {
  return (
    <div className="template-doc">
      {(file.content.content ?? []).map((block, i) => (
        <Block key={i} node={block} />
      ))}
    </div>
  );
}

function SheetPreview({ file }: { file: SheetFile }) {
  const id = file.content.workbook.sheetOrder[0];
  const sheet = file.content.workbook.sheets[id];
  const grid = previewGrid(sheet.cellData as never);
  const columns = grid[0]?.length ?? 0;
  return (
    <div className="template-sheet">
      <table>
        <tbody>
          {grid.map((row, r) => {
            const span = lone(row) ? columns : 1;
            const cells = span > 1 ? row.slice(0, 1) : row;
            return (
              <tr key={r}>
                {cells.map((cell, c) => (
                  <td key={c} style={cellStyle(cell)} colSpan={span > 1 ? columns : undefined}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {file.content.images?.map((image) => (
        <img
          key={image.id}
          className="template-sheet-logo"
          src={image.src}
          alt=""
          style={{ width: Math.min(image.width, 96), height: Math.min(image.height, 96) }}
        />
      ))}
    </div>
  );
}

function lone(row: GridCell[]) {
  return row.filter((cell) => cell.text).length === 1 && row[0]?.text;
}

function cellStyle(cell: GridCell): CSSProperties {
  return {
    fontWeight: cell.bold ? 650 : undefined,
    background: cell.fill,
    fontSize: cell.fontSize ? Math.min(cell.fontSize, 22) : undefined,
    textAlign: cell.align,
  };
}

function SlidePreview({ file, width }: { file: SlideFile; width: number }) {
  const id = file.content.slideOrder[0];
  const slide = file.content.slides[id];
  const scale = width / file.content.width;
  return (
    <div
      className="template-slide-frame"
      style={{
        background: slide.background?.color ?? "#fff",
        width,
        height: file.content.height * scale,
      }}
    >
      <div
        className="template-slide"
        style={{
          width: file.content.width,
          height: file.content.height,
          transform: `scale(${scale})`,
        }}
      >
        {slide.elements.map((el) =>
          el.type === "shape" ? (
            <div
              key={el.id}
              className={`template-shape ${el.shapeType ?? "rect"}`}
              style={{
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
                background: el.fill,
              }}
            />
          ) : el.type === "text" ? (
            <div
              key={el.id}
              className="template-slide-text"
              style={{
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
                fontSize: el.fontSize,
                fontWeight: el.bold ? 700 : 500,
                fontStyle: el.italic ? "italic" : undefined,
                textAlign: el.align ?? "left",
                color: el.color,
              }}
            >
              {el.content}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function TemplatePreview({
  file,
  compact = false,
}: {
  file: SuiteFile;
  compact?: boolean;
}) {
  return (
    <div className={`template-preview ${file.kind}${compact ? " compact" : ""}`}>
      {file.kind === "doc" ? (
        <DocPreview file={file} />
      ) : file.kind === "sheet" ? (
        <SheetPreview file={file} />
      ) : file.kind === "slide" ? (
        <SlidePreview file={file} width={compact ? 112 : 760} />
      ) : (
        <ul className="form-template-preview">
          {file.content.questions.map((q) => (
            <li key={q.id}>{q.prompt || "Untitled question"}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
