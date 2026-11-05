import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import themes from "./themes.json";

test("TPL-009 the web and the server use the same ready-made themes", () => {
  const server = JSON.parse(
    readFileSync(resolve(process.cwd(), "../../backend/domain/src/theme/presets.json"), "utf8"),
  );
  expect(server).toEqual(themes);
});
