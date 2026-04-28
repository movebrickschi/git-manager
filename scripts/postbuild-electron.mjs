import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-electron");

// 根 package.json 声明了 "type": "module"，但 electron/server 代码由 tsc 编译为 CommonJS。
// 在 dist-electron/ 放一个局部 package.json 覆盖 type，防止 Node 把 .js 当 ESM 加载，
// 避免打包后出现 "exports is not defined in ES module scope"。
const pkg = {
  name: "git-manager-electron",
  private: true,
  type: "commonjs",
};

await fs.mkdir(outDir, { recursive: true });
const target = path.join(outDir, "package.json");
await fs.writeFile(target, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`[postbuild-electron] wrote ${path.relative(root, target)}`);
