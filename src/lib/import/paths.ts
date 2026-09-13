import path from "node:path";
import { WORKBOOK_A_FILE, WORKBOOK_B_FILE } from "./types";

/** Where the two private workbooks live: IMPORT_SOURCE_DIR in .env, else data/source in the project. */
export function importSourceDir(): string {
  return process.env.IMPORT_SOURCE_DIR || path.join(process.cwd(), "data", "source");
}

export function sourcePaths(sourceDir: string): { key: "A" | "B"; file: string; path: string }[] {
  return [
    { key: "A", file: WORKBOOK_A_FILE, path: path.join(sourceDir, WORKBOOK_A_FILE) },
    { key: "B", file: WORKBOOK_B_FILE, path: path.join(sourceDir, WORKBOOK_B_FILE) },
  ];
}
