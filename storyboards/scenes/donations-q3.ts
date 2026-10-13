/** The pasted donation list for storyboard 38. Counts are checked in tests/sheet-cleanup.test.ts. */

export type DonationValue = string | number;

const LASTS = [
  "Okafor", "Chen", "Patel", "Nguyen", "Rossi", "Haddad", "Silva", "Novak",
  "Ibrahim", "Keller", "Dubois", "Santos", "Berg", "Okoye", "Walsh",
];
const FIRSTS = [
  "Ade", "Mei", "Priya", "Lan", "Marco", "Nadia", "Rui", "Elena",
  "Yusuf", "Anna", "Camille", "Joao", "Ingrid", "Chidi", "Maeve",
];

const EARLY = [0, 10, 23, 38, 53, 68, 83, 98, 108];
const LATE = [5, 16, 28, 46, 60, 76, 90, 104, 111];

function person(id: number) {
  const last = LASTS[id % LASTS.length]!;
  const first = FIRSTS[id % FIRSTS.length]!;
  return {
    last,
    first,
    donor: `${last}, ${first}`,
    email: `${first}.${last}.${id}@harbour.test`.toLowerCase(),
  };
}

/** 112 data rows. Nine emails appear twice; the later copy has Gift Aid filled in. */
export function donationRows(): DonationValue[][] {
  const lateOf = new Map(LATE.map((late, index) => [late, EARLY[index]!]));
  const identity: number[] = [];
  let next = 0;
  for (let row = 0; row < 112; row++) {
    const early = lateOf.get(row);
    identity.push(early === undefined ? next++ : identity[early]!);
  }
  const rows: DonationValue[][] = [
    ["Date", "Donor", "Email", "Amount", "Gift Aid"],
  ];
  for (let row = 0; row < 112; row++) {
    const who = person(identity[row]!);
    const month = 7 + Math.floor(row / 40);
    const day = (row % 28) + 1;
    const gift = lateOf.has(row) ? "Yes" : "";
    rows.push([
      `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      who.donor,
      who.email,
      15 + ((row * 17) % 180),
      gift,
    ]);
  }
  const cell = (row: number, column: number) => rows[row + 1]![column] as string;
  const set = (row: number, column: number, value: string) => {
    rows[row + 1]![column] = value;
  };
  set(0, 1, `    ${cell(0, 1)}`);
  set(0, 2, `${cell(0, 2)} `);
  set(1, 1, `\u00A0${cell(1, 1)}`);
  set(2, 1, `\u00A0${cell(2, 1)}`);
  set(3, 1, `\u00A0${cell(3, 1)}`);
  set(4, 2, `\u00A0${cell(4, 2)}`);
  set(5, 1, `${cell(5, 1)} `);
  set(6, 1, cell(6, 1).replace(", ", ",  "));
  set(7, 2, `${cell(7, 2)} `);
  set(8, 1, ` ${cell(8, 1)}`);
  set(9, 1, `\t${cell(9, 1)}`);
  set(11, 2, `${cell(11, 2)}  `);
  set(12, 1, ` ${cell(12, 1)}`);
  set(13, 2, `${cell(13, 2)} `);
  set(14, 1, cell(14, 1).replace(", ", ",  "));
  set(15, 2, ` ${cell(15, 2)}`);
  set(17, 1, `${cell(17, 1)} `);
  set(18, 2, `${cell(18, 2)} `);
  set(19, 1, ` ${cell(19, 1)}`);
  set(21, 2, `\t${cell(21, 2)}`);
  set(22, 1, `${cell(22, 1)} `);
  set(24, 2, ` ${cell(24, 2)}`);
  set(26, 1, cell(26, 1).replace(", ", ",  "));
  return rows;
}

export function lastYearRows(): DonationValue[][] {
  return [
    ["Date", "Donor", "Email", "Amount", "Gift Aid"],
    ["2023-11-02", "Okafor, Ade", "ada.okafor@harbour.test", 30, ""],
    ["2023-11-04", "Chen, Mei", "mei.chen@harbour.test", 20, "Yes"],
    ["2023-11-18", "Okafor, Ade", "ada.okafor@harbour.test", 15, "Yes"],
    ["2023-12-01", "Patel, Priya", "priya.patel@harbour.test", 50, ""],
    ["2023-12-09", "Nguyen, Lan", "lan.nguyen@harbour.test", 12, "Yes"],
  ];
}

export const donationWidths = [110, 150, 210, 80, 88];
