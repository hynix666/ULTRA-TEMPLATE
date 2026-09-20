import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFile, checkTree } from "./check-boundaries.mjs";

// Each rule must be seen to fire. A checker proven only on clean code passes just as well when broken.
describe("check-boundaries", () => {
  it("keeps features out of each other and out of the app", () => {
    expect(checkFile("src/features/tasks/api.ts", 'import { x } from "../users/api.ts";')).toHaveLength(1);
    expect(checkFile("src/features/tasks/api.ts", 'import { App } from "../../app/app.tsx";')).toHaveLength(1);
    expect(checkFile("src/features/tasks/api.ts", 'import { requestJson } from "../../lib/http.ts";\nimport { z } from "zod";')).toEqual([]);
  });

  it("lets the app use a feature only through its index", () => {
    for (const spec of ["../features/tasks", "../features/tasks/index", "../features/tasks/index.ts"]) {
      expect(checkFile("src/app/app.tsx", `import { TaskBoard } from "${spec}";`), spec).toEqual([]);
    }
    expect(checkFile("src/app/app.tsx", 'import { TaskBoard } from "../features/tasks/components/task-board.tsx";')).toHaveLength(1);
    expect(checkFile("src/app/app.tsx", 'import { listTasks } from "../features/tasks/api";')).toHaveLength(1);
  });

  it("keeps shared code free of features and the app", () => {
    expect(checkFile("src/lib/http.ts", 'const m = await import("../features/tasks/model.ts");')).toHaveLength(1);
  });

  it("fails a file outside every layer, except the entry point", () => {
    expect(checkFile("src/helpers.ts", "export const x = 1;")).toHaveLength(1);
    expect(checkFile("src/main.tsx", 'import { App } from "./app/app.tsx";')).toEqual([]);
  });

  it("finds no violations in the real source tree", () => {
    const { files, problems } = checkTree(join(dirname(fileURLToPath(import.meta.url)), ".."));
    expect(files).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
