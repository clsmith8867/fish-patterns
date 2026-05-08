import fs from "fs";
import path from "path";
import sharp from "sharp";

const inputDir = "./public/icons";
const outputDir = "./public/icons-normalized";

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const files = fs
  .readdirSync(inputDir)
  .filter((file) => file.toLowerCase().endsWith(".png"));

for (const file of files) {
  const inputPath = path.join(inputDir, file);
  const outputPath = path.join(outputDir, file);

  const image = sharp(inputPath).ensureAlpha();

  const trimmedBuffer = await image
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .resize({
      width: 220,
      height: 220,
      fit: "inside",
      withoutEnlargement: false
    })
    .extend({
      top: 18,
      bottom: 18,
      left: 18,
      right: 18,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .resize(256, 256, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  fs.writeFileSync(outputPath, trimmedBuffer);
  console.log(`Normalized: ${file}`);
}

console.log("Done.");