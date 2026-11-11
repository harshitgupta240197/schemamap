import { describe, expect, it } from "vitest";
import { compactLabel, middleEllipsis, nameParts } from "./labels";

describe("nameParts", () => {
  it("breaks at CamelCase, underscore, dot, dash and space", () => {
    expect(nameParts("SalesOrderHeader")).toEqual(["Sales", "Order", "Header"]);
    expect(nameParts("sales_order.header")).toEqual(["sales_", "order.", "header"]);
    expect(nameParts("Order Detail-Line")).toEqual(["Order ", "Detail-", "Line"]);
    expect(nameParts("XMLParser2Go")).toEqual(["XML", "Parser", "2", "Go"]);
  });
});

describe("middleEllipsis", () => {
  it("keeps the start and the end and fits the limit", () => {
    const cut = middleEllipsis("BusinessEntityAddress", 11);
    expect(cut).toBe("Busin…dress");
    expect(Array.from(cut)).toHaveLength(11);
  });

  it("leaves a short text alone and copes with tiny limits", () => {
    expect(middleEllipsis("Shift", 5)).toBe("Shift");
    expect(middleEllipsis("Shift", 1)).toBe("…");
    expect(middleEllipsis("Shift", 2)).toBe("S…");
  });

  it("never splits a surrogate pair", () => {
    expect(middleEllipsis("😀😀😀😀😀😀", 4)).toBe("😀😀…😀");
  });
});

describe("compactLabel", () => {
  it("keeps a name that fits on one line", () => {
    expect(compactLabel("Shift", 10)).toEqual(["Shift"]);
  });

  it("breaks a long name at a word boundary into two balanced lines", () => {
    expect(compactLabel("SalesOrderHeader", 12)).toEqual(["SalesOrder", "Header"]);
    expect(compactLabel("sales_order_header", 12)).toEqual(["sales_", "order_header"]);
  });

  it("keeps SalesOrderHeader and SalesOrderDetail apart", () => {
    for (const chars of [8, 10, 12, 16]) {
      expect(compactLabel("SalesOrderHeader", chars)).not.toEqual(
        compactLabel("SalesOrderDetail", chars),
      );
    }
  });

  it("cuts the middle of a line that is still too long, never the whole name", () => {
    const lines = compactLabel("SalesOrderHeaderSalesReason", 12);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(12);
    }
    expect(lines.join("")).toContain("…");
    expect(lines[0]?.startsWith("Sales")).toBe(true);
    expect(lines[1]?.endsWith("Reason")).toBe(true);
  });

  it("puts a single long word on one line with a middle ellipsis", () => {
    expect(compactLabel("Supercalifragilistic", 10)).toEqual(["Super…stic"]);
  });

  it("breaks between letters and digits and honours a one-line limit", () => {
    expect(compactLabel("Account1903", 7)).toEqual(["Account", "1903"]);
    expect(compactLabel("SalesOrderHeader", 9, 1)).toEqual(["Sale…ader"]);
  });

  it("handles hostile names as plain text within the limit", () => {
    const hostile = `</script><img src=x onerror="alert(1)">`;
    const lines = compactLabel(hostile, 12);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(12);
    }
  });

  it("is deterministic and never returns an empty line for a non-empty name", () => {
    for (const name of ["a", "a_b", "_", "A.B.C.D.E.F.G.H", "  spaced  name  "]) {
      const first = compactLabel(name, 4);
      expect(compactLabel(name, 4)).toEqual(first);
      expect(first.every((line) => line !== "")).toBe(true);
    }
  });
});

describe("measured widths", () => {
  /** Wide letters take two units, the rest one: m and W stand for wide glyphs. */
  const width = (text: string): number =>
    Array.from(text).reduce((sum, char) => sum + ("mW…".includes(char) ? 2 : 1), 0);

  it("cuts a line by its width, not its length", () => {
    expect(middleEllipsis("Shipment0866", 10, width)).toBe("Ship…0866");
    expect(width(middleEllipsis("mmmmmmmmmmmm", 9, width))).toBeLessThanOrEqual(9);
  });

  it("breaks a name so each line fits the width", () => {
    for (const line of compactLabel("WorkOrderRoutingMember", 12, 2, width)) {
      expect(width(line)).toBeLessThanOrEqual(12);
    }
  });
});
