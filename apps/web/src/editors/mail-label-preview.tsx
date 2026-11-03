import { AVERY_5160, ENVELOPE_10, type PlacedAddress } from "./mail-labels";

const LABEL_SCALE = 280 / AVERY_5160.pageWidth;
const ENVELOPE_SCALE = 320 / ENVELOPE_10.pageWidth;

function paint(box: PlacedAddress, scale: number, className: string) {
  return (
    <div
      key={`${box.page}-${box.x}-${box.y}`}
      className={className}
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
      }}
    >
      {box.lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  );
}

/** The Avery 5160 sheet, scaled so the boxes can be measured on screen. */
export function LabelSheetPreview({ placed }: { placed: PlacedAddress[] }) {
  const pages = Math.max(1, ...placed.map((box) => box.page + 1));
  return (
    <div className="label-preview" aria-label="Avery 5160">
      <p className="merge-note">
        Avery 5160. 30 labels on a US Letter sheet. Each label is 189 by 72 points. Nothing is mailed.
      </p>
      {Array.from({ length: pages }, (_, page) => (
        <div
          key={page}
          className="label-sheet"
          data-page={page}
          style={{
            width: AVERY_5160.pageWidth * LABEL_SCALE,
            height: AVERY_5160.pageHeight * LABEL_SCALE,
          }}
        >
          {placed.filter((box) => box.page === page).map((box) => paint(box, LABEL_SCALE, "label-slot"))}
        </div>
      ))}
    </div>
  );
}

/** A #10 envelope. The return address and the recipient are separate boxes. */
export function EnvelopePreview({
  returnAddress,
  recipient,
}: {
  returnAddress: PlacedAddress;
  recipient: PlacedAddress;
}) {
  return (
    <div className="label-preview" aria-label="Envelope #10">
      <p className="merge-note">Envelope #10. 684 by 297 points. Nothing is mailed.</p>
      <div
        className="label-sheet envelope-sheet"
        style={{
          width: ENVELOPE_10.pageWidth * ENVELOPE_SCALE,
          height: ENVELOPE_10.pageHeight * ENVELOPE_SCALE,
        }}
      >
        {paint(returnAddress, ENVELOPE_SCALE, "label-slot")}
        {paint(recipient, ENVELOPE_SCALE, "label-slot recipient-slot")}
      </div>
    </div>
  );
}
