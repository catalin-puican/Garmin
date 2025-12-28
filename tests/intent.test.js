import { describe, it, expect } from "vitest";
import { parseIntent } from "../src/voice/intent.js";

describe("Intent parsing", () => {
  it("detects play", () => {
    const i = parseIntent("Ok Garmin play despacito");
    expect(i.type).toBe("play");
    expect(i.query).toBe("despacito");
  });
});
