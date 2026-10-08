// Downloads the official OASIS CAP 1.2 XSD used by check C6 and verifies its SHA-256.
// The file is not committed: its header reserves all rights to OASIS.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CAP_XSD, CAP_XSD_SHA256, CAP_XSD_URL } from "./checks.ts";

const res = await fetch(CAP_XSD_URL);
if (!res.ok) throw new Error(`${CAP_XSD_URL}: HTTP ${res.status}`);
const text = await res.text();
const hash = createHash("sha256").update(text).digest("hex");
if (hash !== CAP_XSD_SHA256) throw new Error(`unexpected SHA-256 ${hash}`);
mkdirSync(dirname(CAP_XSD), { recursive: true });
writeFileSync(CAP_XSD, text);
console.log("wrote", CAP_XSD);
