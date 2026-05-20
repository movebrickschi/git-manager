import sharp from "sharp";
import pngToIco from "png-to-ico";
import png2icons from "png2icons";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const SVG_PATH = path.join(root, "public", "vite.svg");
const ICO_OUT = path.join(root, "build", "icon.ico");
const ICNS_OUT = path.join(root, "build", "icon.icns");
const PNG_BASE_OUT = path.join(root, "build", "icon.png");

const ICO_SIZES = [16, 32, 48, 64, 128, 256];
// icns 需要 1024x1024 作为最大分辨率（macOS @3x retina），png2icons 内部按位向下采样。
const ICNS_BASE_SIZE = 1024;

async function main() {
  const svg = await fs.readFile(SVG_PATH);
  const wrapped = wrapSvg(svg.toString());

  await fs.mkdir(path.dirname(ICO_OUT), { recursive: true });

  const icoPngBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(Buffer.from(wrapped))
        .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );
  const ico = await pngToIco(icoPngBuffers);
  await fs.writeFile(ICO_OUT, ico);
  console.log(`icon written: ${path.relative(root, ICO_OUT)} (${ICO_SIZES.join(", ")})`);

  const basePng = await sharp(Buffer.from(wrapped))
    .resize(ICNS_BASE_SIZE, ICNS_BASE_SIZE, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();

  // 顺手落一份 icon.png，electron-builder linux 目标默认会找它。
  await fs.writeFile(PNG_BASE_OUT, basePng);

  // png2icons.createICNS(srcPng, scalingAlgorithm, numOfColors)
  // BEZIER 抗锯齿质量最高；0 表示保留原图色深。返回 Buffer，失败返回 null。
  const icns = png2icons.createICNS(basePng, png2icons.BEZIER, 0);
  if (!icns) {
    throw new Error("png2icons.createICNS returned null");
  }
  await fs.writeFile(ICNS_OUT, icns);
  console.log(`icon written: ${path.relative(root, ICNS_OUT)} (${ICNS_BASE_SIZE}x${ICNS_BASE_SIZE} base)`);
}

function wrapSvg(src) {
  if (/viewBox\s*=/.test(src)) return src;
  return src.replace(/<svg\b/, '<svg viewBox="0 0 24 24"');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
