import { describe, expect, it } from "vitest";

import { createUniqueHeadingAnchorGenerator } from "./heading-anchor";

describe("createUniqueHeadingAnchorGenerator", () => {
  it("adds stable numeric suffixes for duplicate heading text", () => {
    const nextAnchor = createUniqueHeadingAnchorGenerator();

    expect(nextAnchor("推导链")).toBe("推导链");
    expect(nextAnchor("推导链")).toBe("推导链-2");
    expect(nextAnchor("推导链")).toBe("推导链-3");
  });

  it("uses normalized heading text when detecting duplicates", () => {
    const nextAnchor = createUniqueHeadingAnchorGenerator();

    expect(nextAnchor("A **Bold** Title")).toBe("a-bold-title");
    expect(nextAnchor("A Bold Title")).toBe("a-bold-title-2");
  });
});
