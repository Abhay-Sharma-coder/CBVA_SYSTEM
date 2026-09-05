import sharp from "sharp";
const [,, src, out, top, height] = process.argv;
await sharp(src).extract({ left: 0, top: Number(top), width: 1440, height: Number(height) }).toFile(out);
console.log("cropped →", out);
