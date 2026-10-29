import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const outputRoot =
  process.env.REVIEW_EVIDENCE_DIR || "test-results/remediation";

export function evidencePath(...parts: string[]) {
  const target = join(outputRoot, ...parts);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}
