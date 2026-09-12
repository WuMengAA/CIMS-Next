import { readFileSync, readdirSync } from "node:fs";
import matter from "gray-matter";

const dirs = ["content/posts", "content/projects", "content/docs"];
let bad = 0;
let total = 0;

for (const d of dirs) {
  let files = [];
  try {
    files = readdirSync(d).filter((f) => f.endsWith(".md"));
  } catch {
    continue;
  }
  for (const f of files) {
    const p = d + "/" + f;
    total++;
    try {
      matter(readFileSync(p, "utf-8"));
    } catch (e) {
      bad++;
      const first = String(e.message || e).split("\n")[0];
      console.log("BAD  " + p + "\n     " + first);
    }
  }
}

console.log(bad === 0 ? "ALL OK (" + total + " files)" : bad + " / " + total + " files failed");
