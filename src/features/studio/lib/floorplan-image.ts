const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_BYTES = 2 * 1024 * 1024;
// 视觉模型按像素计费 token：1024 长边会多吃约 30% 的 token，896 对户型图识别精度没有可见损失。
const MAX_EDGE = 896;
const DISPLAY_QUALITY = 0.78;
const RECOGNITION_QUALITY = 0.8;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProcessedFloorplanImage = {
  /** 预览用（不带参考网格）。 */
  dataUrl: string;
  /** 识别请求用（叠 10×10 参考网格），与预览同一次解码、同一次缩放产出。 */
  recognitionDataUrl: string;
  width: number;
  height: number;
  name: string;
  /** 识别图的近似字节数，用于在上传前给出体积提示。 */
  bytes: number;
};

function dataUrlBytes(value: string) {
  const comma = value.indexOf(",");
  const body = comma >= 0 ? value.slice(comma + 1) : value;
  return Math.ceil((body.length * 3) / 4);
}

function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取这张图片。"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function decodeImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法解码，请换一张清晰的 JPG、PNG 或 WebP。"));
    image.src = dataUrl;
  });
}

function makeCanvas(image: HTMLImageElement, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。请尝试刷新后重试。");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return { canvas, width, height };
}

function compress(canvas: HTMLCanvasElement, startQuality: number) {
  let quality = startQuality;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlBytes(dataUrl) > MAX_DATA_URL_BYTES && quality > 0.46) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrlBytes(dataUrl) > MAX_DATA_URL_BYTES) throw new Error("图片压缩后仍然超过 2MB，请裁剪后再识别。");
  return dataUrl;
}

// 只给识别请求用的临时副本：叠一层 10×10 半透明参考网格，
// 让模型按格线读端点，而不是盲猜像素距离。原图本身不变。
function drawReferenceGrid(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。");
  context.strokeStyle = "rgba(90,90,90,0.22)";
  context.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const x = Math.round((canvas.width * i) / 10) + 0.5;
    const y = Math.round((canvas.height * i) / 10) + 0.5;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
    context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
  }
}

function encodePair(canvas: HTMLCanvasElement) {
  const dataUrl = compress(canvas, DISPLAY_QUALITY);
  // 网格画在同一张 canvas 上：预览图已经编码完成，不会受影响。
  drawReferenceGrid(canvas);
  const recognitionDataUrl = compress(canvas, RECOGNITION_QUALITY);
  return { dataUrl, recognitionDataUrl, bytes: dataUrlBytes(recognitionDataUrl) };
}

export async function processFloorplanImage(file: File): Promise<ProcessedFloorplanImage> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("只支持 JPG、PNG 和 WebP 图片。");
  if (file.size > MAX_FILE_BYTES) throw new Error("图片不能超过 10MB。");
  const source = await readAsDataUrl(file);
  const image = await decodeImage(source);
  const { canvas, width, height } = makeCanvas(image, MAX_EDGE);
  const encoded = encodePair(canvas);
  return { ...encoded, width, height, name: file.name.slice(0, 200) || "户型图.jpg" };
}

export async function rotateFloorplanImage(input: ProcessedFloorplanImage, clockwise = true) {
  const image = await decodeImage(input.dataUrl);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = height;
  canvas.height = width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法旋转图片。");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((clockwise ? 1 : -1) * Math.PI / 2);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  const encoded = encodePair(canvas);
  return { ...input, ...encoded, width: canvas.width, height: canvas.height };
}

export async function cropFloorplanImage(input: ProcessedFloorplanImage, start: [number, number], end: [number, number]) {
  const image = await decodeImage(input.dataUrl);
  const x = Math.max(0, Math.min(start[0], end[0]));
  const y = Math.max(0, Math.min(start[1], end[1]));
  const width = Math.min(input.width - x, Math.abs(end[0] - start[0]));
  const height = Math.min(input.height - y, Math.abs(end[1] - start[1]));
  if (width < 32 || height < 32) throw new Error("裁剪范围太小，请重新框选。");
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法裁剪图片。");
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  const encoded = encodePair(canvas);
  return { ...input, ...encoded, width: canvas.width, height: canvas.height };
}
