import sharp from "sharp";
import pngToIco from "png-to-ico";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const SVG_PATH = path.join(root, "public", "vite.svg");
const ICO_OUT = path.join(root, "build", "icon.ico");
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const svg = await fs.readFile(SVG_PATH);
  const wrapped = wrapSvg(svg.toString());

  const pngBuffers = await Promise.all(
    SIZES.map((size) =>
      sharp(Buffer.from(wrapped))
        .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  await fs.mkdir(path.dirname(ICO_OUT), { recursive: true });
  const ico = await pngToIco(pngBuffers);
  await fs.writeFile(ICO_OUT, ico);

  console.log(`icon written: ${path.relative(root, ICO_OUT)} (${SIZES.join(", ")})`);
}

function wrapSvg(src) {
  if (/viewBox\s*=/.test(src)) return src;
  return src.replace(
    /<svg\b/,
    '<svg viewBox="0 0 24 24"'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
