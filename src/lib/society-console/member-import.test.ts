import { describe, expect, it } from "vitest";

import { importSummary, normaliseEmail, parseCsv, readMemberList, sanitiseRows, societyInviteEmail } from "./member-import";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿Name,Email\r\n"Byrne, Jane","jane@x.ie"\r\n"Seán ""Bomber"" Lee",sean@x.ie\r\n')).toEqual([
      ["Name", "Email"],
      ["Byrne, Jane", "jane@x.ie"],
      ['Seán "Bomber" Lee', "sean@x.ie"],
    ]);
  });
  it("picks semicolons and tabs (European Excel, Numbers)", () => {
    expect(parseCsv("First name;Email\nJane;jane@x.ie")).toEqual([["First name", "Email"], ["Jane", "jane@x.ie"]]);
    expect(parseCsv("Email\tSurname\njane@x.ie\tByrne")).toEqual([["Email", "Surname"], ["jane@x.ie", "Byrne"]]);
  });
  it("drops blank lines", () => {
    expect(parseCsv("a@x.ie\n\n,\nb@x.ie\n")).toEqual([["a@x.ie"], ["b@x.ie"]]);
  });
});

describe("normaliseEmail", () => {
  it("lower-cases, trims, and takes the address out of a display name", () => {
    expect(normaliseEmail("  Jane.Byrne@Example.IE ")).toBe("jane.byrne@example.ie");
    expect(normaliseEmail("Jane Byrne <jane@x.ie>")).toBe("jane@x.ie");
    expect(normaliseEmail("mailto:jane@x.ie")).toBe("jane@x.ie");
  });
  it("refuses what isn't an address", () => {
    for (const v of ["", "jane", "jane@", "@x.ie", "jane@x", "ja ne@x.ie"]) expect(normaliseEmail(v)).toBeNull();
  });
});

describe("readMemberList", () => {
  it("finds columns by name, in any order", () => {
    const p = readMemberList("Surname,Forename,E-mail address,Handicap\nByrne,Jane,jane@x.ie,12.4\nLee,Seán,SEAN@x.ie,8");
    expect(p.rows).toEqual([
      { email: "jane@x.ie", firstName: "Jane", lastName: "Byrne" },
      { email: "sean@x.ie", firstName: "Seán", lastName: "Lee" },
    ]);
    expect(p.columns.header).toBe(true);
  });
  it("splits a single Name column, including 'Surname, First'", () => {
    const p = readMemberList('Member Name,Email\nJane Mary Byrne,jane@x.ie\n"Lee, Seán",sean@x.ie\nPaddy,paddy@x.ie');
    expect(p.rows.map((r) => [r.firstName, r.lastName])).toEqual([
      ["Jane Mary", "Byrne"],
      ["Seán", "Lee"],
      ["Paddy", null],
    ]);
  });
  it("works with no header: the column of addresses, names before it", () => {
    expect(readMemberList("Jane,Byrne,jane@x.ie\nSeán,Lee,sean@x.ie").rows[1]).toEqual({ email: "sean@x.ie", firstName: "Seán", lastName: "Lee" });
    expect(readMemberList("Jane Byrne,jane@x.ie").rows[0]).toEqual({ email: "jane@x.ie", firstName: "Jane", lastName: "Byrne" });
  });
  it("takes a pasted list, one address per line", () => {
    expect(readMemberList("a@x.ie\nb@x.ie\nJane Byrne <c@x.ie>").rows.map((r) => r.email)).toEqual(["a@x.ie", "b@x.ie", "c@x.ie"]);
  });
  it("reports bad and duplicate rows with their line numbers", () => {
    const p = readMemberList("Email\njane@x.ie\nnot an email\nJANE@x.ie\n,\nsean@x.ie");
    expect(p.rows.map((r) => r.email)).toEqual(["jane@x.ie", "sean@x.ie"]);
    expect(p.problems).toEqual([
      { line: 3, value: "not an email", reason: "invalid" },
      { line: 4, value: "jane@x.ie", reason: "duplicate" },
    ]);
  });
  it("stops at 500", () => {
    const text = Array.from({ length: 503 }, (_, i) => `m${i}@x.ie`).join("\n");
    const p = readMemberList(text);
    expect(p.rows).toHaveLength(500);
    expect(p.truncated).toBe(true);
  });
  it("empty in, empty out", () => {
    expect(readMemberList("   \n").rows).toEqual([]);
  });
});

describe("sanitiseRows", () => {
  it("re-checks what the browser sent", () => {
    expect(
      sanitiseRows([{ email: "A@x.ie", firstName: " Jane ", lastName: 5 }, { email: "a@x.ie" }, { email: "nope" }, null, "x", { email: "b@x.ie", firstName: "x".repeat(99) }])
    ).toEqual([
      { email: "a@x.ie", firstName: "Jane", lastName: null },
      { email: "b@x.ie", firstName: "x".repeat(60), lastName: null },
    ]);
    expect(sanitiseRows("nope")).toEqual([]);
  });
});

describe("importSummary", () => {
  it("says what happened in one line", () => {
    expect(importSummary({ invited: 38, added: 4, already_member: 2 })).toBe("38 invitations emailed, 4 already on PinPals and added, 2 already members.");
    expect(importSummary({ invited: 1 }, 1)).toBe("1 invitation emailed. 1 email didn't send — use Resend below.");
    expect(importSummary({})).toBe("Nobody new to invite.");
  });
});

describe("societyInviteEmail", () => {
  it("invites by name, and says which address to use", () => {
    const e = societyInviteEmail({ kind: "invite", societyName: "Portmarnock Thursday Society", inviterName: "Eire", firstName: "Jane", email: "jane@x.ie", link: "https://www.pinpals.ie/join/s/x" });
    expect(e.subject).toContain("Portmarnock Thursday Society");
    expect(e.bodyLines[0]).toBe("Hi Jane,");
    expect(e.bodyLines.join(" ")).toContain("jane@x.ie");
  });
  it("tells someone already on PinPals they've been added", () => {
    const e = societyInviteEmail({ kind: "added", societyName: "S", inviterName: null, firstName: null, email: "a@x.ie", link: "l" });
    expect(e.subject).toBe("You're now in S on PinPals");
    expect(e.bodyLines.join(" ")).toContain("Leave");
  });
});
