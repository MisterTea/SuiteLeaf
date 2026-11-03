import { useRef, useState } from "react";
import { goalSeekAsync, seekProgressText } from "@suiteleaf/core";

export type SeekAddress = { row: number; column: number };

export type SeekRead = { formula: string; value: unknown };

/** A1-style address. `B2` is row 1, column 1. */
export function parseCellAddress(input: string): SeekAddress | null {
  const match = /^([A-Za-z]{1,3})([1-9]\d*)$/.exec(input.trim());
  if (!match) return null;
  let column = 0;
  for (const char of match[1].toUpperCase())
    column = column * 26 + (char.charCodeAt(0) - 64);
  const row = Number(match[2]) - 1;
  if (row > 1_000_000 || column - 1 > 16_384) return null;
  return { row, column: column - 1 };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function show(value: number): string {
  const text = value.toFixed(6).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/**
 * Change the input cell until the formula cell reaches the target.
 * A formula in the input cell is not overwritten. A search that does not
 * solve puts the input cell back.
 */
export async function seekOnSheet(input: {
  input: SeekAddress;
  formula: SeekAddress;
  target: number;
  low: number;
  high: number;
  read: (cell: SeekAddress) => SeekRead;
  write: (cell: SeekAddress, value: string | number | boolean | null) => void;
  calculate: () => Promise<void>;
  shouldStop?: () => boolean;
}): Promise<{ message: string; wrote: boolean }> {
  if (input.input.row === input.formula.row && input.input.column === input.formula.column)
    return { message: "The input cell and the formula cell are the same.", wrote: false };
  const current = input.read(input.input);
  if (current.formula.trim())
    return { message: "The input cell has a formula.", wrote: false };
  const formula = input.read(input.formula);
  if (!formula.formula.trim()) return { message: "That cell has no formula.", wrote: false };
  const original = current.value;
  const restore = () => {
    input.write(
      input.input,
      typeof original === "string" || typeof original === "number" || typeof original === "boolean"
        ? original
        : null,
    );
  };
  const start = finite(original) ? original : input.low;
  try {
    const result = await goalSeekAsync({
      target: input.target,
      start,
      low: input.low,
      high: input.high,
      shouldStop: input.shouldStop,
      evaluate: async (guess) => {
        input.write(input.input, guess);
        await input.calculate();
        const value = input.read(input.formula).value;
        if (!finite(value)) throw new Error("The formula did not return a number.");
        return value;
      },
    });
    if (!result.ok) {
      restore();
      return {
        message: `${seekProgressText(result)} The input cell was put back.`,
        wrote: false,
      };
    }
    input.write(input.input, result.guess);
    return {
      message: `The input cell is now ${show(result.guess)}. ${seekProgressText(result)}`,
      wrote: true,
    };
  } catch {
    restore();
    return {
      message: "The formula could not be calculated. The input cell was put back.",
      wrote: false,
    };
  }
}

/** Goal Seek for the selected input cell. The formula cell is named, such as B2. */
export function SheetGoalPanel({
  disabled,
  onSeek,
  onSolve,
}: {
  disabled: boolean;
  onSeek: (input: {
    formula: string;
    target: number;
    low: number;
    high: number;
    shouldStop: () => boolean;
  }) => Promise<{ message: string; wrote: boolean }>;
  onSolve?: (input: {
    formula: string;
    second: string;
    third?: string;
    target: number;
    low: number;
    high: number;
    secondLow: number;
    secondHigh: number;
    thirdLow?: number;
    thirdHigh?: number;
    atMost?: number;
    shouldStop: () => boolean;
  }) => Promise<{ message: string; wrote: boolean }>;
}) {
  const [formula, setFormula] = useState("");
  const [target, setTarget] = useState("");
  const [low, setLow] = useState("0");
  const [high, setHigh] = useState("100");
  const [second, setSecond] = useState("");
  const [secondLow, setSecondLow] = useState("0");
  const [secondHigh, setSecondHigh] = useState("100");
  const [third, setThird] = useState("");
  const [thirdLow, setThirdLow] = useState("0");
  const [thirdHigh, setThirdHigh] = useState("100");
  const [atMost, setAtMost] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  return (
    <section className="access-notes" aria-label="Goal Seek">
      <h2>Goal Seek</h2>
      <p>
        Changes the selected input cell until the formula cell reaches the target. Name a second
        input to search both cells inside their bounds. Name a third input to search that cell too.
        A formula in an input cell is left alone. At most keeps the selected input at or below that number when a second input is named.
      </p>
      <label>
        Formula cell
        <input
          aria-label="Formula cell"
          value={formula}
          onChange={(event) => setFormula(event.target.value)}
          placeholder="B2"
        />
      </label>
      <label>
        Target
        <input
          aria-label="Goal target"
          inputMode="decimal"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <label>
        Second input
        <input
          aria-label="Second input"
          value={second}
          onChange={(event) => setSecond(event.target.value)}
          placeholder="C2"
        />
      </label>
      <label>
        Low
        <input
          aria-label="Low guess"
          inputMode="decimal"
          value={low}
          onChange={(event) => setLow(event.target.value)}
        />
      </label>
      <label>
        High
        <input
          aria-label="High guess"
          inputMode="decimal"
          value={high}
          onChange={(event) => setHigh(event.target.value)}
        />
      </label>
      <label>
        Second low
        <input
          aria-label="Second low"
          inputMode="decimal"
          value={secondLow}
          onChange={(event) => setSecondLow(event.target.value)}
        />
      </label>
      <label>
        Second high
        <input
          aria-label="Second high"
          inputMode="decimal"
          value={secondHigh}
          onChange={(event) => setSecondHigh(event.target.value)}
        />
      </label>
      <label>
        At most
        <input
          aria-label="At most"
          inputMode="decimal"
          value={atMost}
          onChange={(event) => setAtMost(event.target.value)}
        />
      </label>
      <label>
        Third input
        <input
          aria-label="Third input"
          value={third}
          onChange={(event) => setThird(event.target.value)}
          placeholder="D2"
        />
      </label>
      <label>
        Third low
        <input
          aria-label="Third low"
          inputMode="decimal"
          value={thirdLow}
          onChange={(event) => setThirdLow(event.target.value)}
        />
      </label>
      <label>
        Third high
        <input
          aria-label="Third high"
          inputMode="decimal"
          value={thirdHigh}
          onChange={(event) => setThirdHigh(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          const address = parseCellAddress(formula);
          const targetNumber = Number(target);
          const lowNumber = Number(low);
          const highNumber = Number(high);
          const secondLowNumber = Number(secondLow);
          const secondHighNumber = Number(secondHigh);
          const thirdLowNumber = Number(thirdLow);
          const thirdHighNumber = Number(thirdHigh);
          if (!address) {
            setMessage("Name the formula cell, such as B2.");
            return;
          }
          if (![targetNumber, lowNumber, highNumber].every(Number.isFinite) || !(lowNumber < highNumber)) {
            setMessage("Enter a target between a low guess and a higher guess.");
            return;
          }
          const namedSecond = second.trim();
          const namedThird = third.trim();
          const limitText = atMost.trim();
          let limit: number | undefined;
          if (limitText) {
            limit = Number(limitText);
            if (!Number.isFinite(limit)) {
              setMessage("The limit is not a number.");
              return;
            }
            if (!namedSecond) {
              setMessage("Name a second input to use the limit.");
              return;
            }
          }
          if (namedThird && !namedSecond) {
            setMessage("Name the second input before the third.");
            return;
          }
          if (namedSecond) {
            if (!parseCellAddress(namedSecond)) {
              setMessage("Name the second input, such as C2.");
              return;
            }
            if (!onSolve) {
              setMessage("The second input is not used.");
              return;
            }
            if (![secondLowNumber, secondHighNumber].every(Number.isFinite) || !(secondLowNumber < secondHighNumber)) {
              setMessage("Enter a low bound and a higher bound for the second input.");
              return;
            }
            if (namedThird && !parseCellAddress(namedThird)) {
              setMessage("Name the third input, such as D2.");
              return;
            }
            if (
              namedThird &&
              (![thirdLowNumber, thirdHighNumber].every(Number.isFinite) || !(thirdLowNumber < thirdHighNumber))
            ) {
              setMessage("Enter a low bound and a higher bound for the third input.");
              return;
            }
          }
          setBusy(true);
          stop.current = false;
          const shouldStop = () => stop.current;
          const run = namedSecond
            ? onSolve!({
                shouldStop,
                formula,
                second: namedSecond,
                ...(namedThird
                  ? { third: namedThird, thirdLow: thirdLowNumber, thirdHigh: thirdHighNumber }
                  : {}),
                target: targetNumber,
                low: lowNumber,
                high: highNumber,
                secondLow: secondLowNumber,
                secondHigh: secondHighNumber,
                ...(limit === undefined ? {} : { atMost: limit }),
              })
            : onSeek({ formula, target: targetNumber, low: lowNumber, high: highNumber, shouldStop });
          void run.then((result) => {
            setMessage(result.message);
            setBusy(false);
          });
        }}
      >
        {second.trim() || third.trim() ? "Solve" : "Seek"}
      </button>
      {busy ? (
        <button type="button" onClick={() => (stop.current = true)}>
          Stop
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
