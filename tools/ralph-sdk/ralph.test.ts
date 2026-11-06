import assert from "node:assert/strict";
import test from "node:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { blockers, reviewSchema } from "./ralph.ts";

test("решение об одобрении принимает код по P0/P1", () => {
  const findings = reviewSchema.parse({
    findings: ["P0", "P1", "P2", "P3"].map((priority) => ({
      priority,
      file: "src/file.ts",
      line: 12,
      text: "Полный текст замечания",
    })),
  }).findings;
  assert.deepEqual(
    blockers(findings).map((f) => f.priority),
    ["P0", "P1"],
  );
  assert.equal(blockers(findings.slice(2)).length, 0);
  assert.equal(blockers([]).length, 0);
  assert.throws(() => reviewSchema.parse({ findings: [{ priority: "P9" }] }));
});

test("OpenAI schema содержит findings и обязательные поля замечания", () => {
  const schema = zodToJsonSchema(reviewSchema, { target: "openAi" });
  const json = JSON.stringify(schema);
  for (const field of ["findings", "priority", "file", "line", "text"])
    assert.ok(json.includes(`"${field}"`));
  assert.ok(json.includes('"additionalProperties":false'));
});
