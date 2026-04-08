/**
 * 阿里云 OSS 集成模块
 *
 * 当 OSS 未配置时，所有操作回退到本地数据库存储（Image 表）
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS_ACCESS_KEY = process.env.OSS_ACCESS_KEY;
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET;
const OSS_BUCKET = process.env.OSS_BUCKET;
const OSS_REGION = process.env.OSS_REGION || "oss-cn-hangzhou";
const OSS_ENDPOINT = process.env.OSS_ENDPOINT || `https://${OSS_REGION}.aliyuncs.com`;

/** OSS 是否启用 */
export function isOssEnabled(): boolean {
  return !!(OSS_ACCESS_KEY && OSS_ACCESS_KEY_SECRET && OSS_BUCKET);
}

/** 获取 OSS 客户端（懒加载） */
let ossClient: any = null;

async function getOssClient() {
  if (ossClient) return ossClient;

  if (!isOssEnabled()) {
    throw new Error("OSS is not configured");
  }

  // 动态导入 ali-oss，避免打包时拉取原生依赖
  const aliOss = await import(/* webpackIgnore: true */ "ali-oss");
  const OSS = aliOss.default || aliOss;
  ossClient = new OSS({
    accessKeyId: OSS_ACCESS_KEY!,
    accessKeySecret: OSS_ACCESS_KEY_SECRET!,
    bucket: OSS_BUCKET!,
    region: OSS_REGION,
    endpoint: OSS_ENDPOINT,
  });

  return ossClient;
}

/** 生成 OSS 对象 key */
function ossKey(imageId: string, mimeType: string): string {
  const ext = mimeType.split("/")[1] || "png";
  return `images/${imageId}.${ext}`;
}

/**
 * 上传图片到 OSS
 */
export async function uploadImageToOss(
  imageId: string,
  mimeType: string,
  data: Buffer | Uint8Array
): Promise<void> {
  const client = await getOssClient();
  await client.put(ossKey(imageId, mimeType), data, {
    mime: mimeType,
  });
}

/**
 * 从 OSS 下载图片
 * @returns 图片 Buffer，如果 OSS 未启用或下载失败返回 null
 */
export async function downloadImageFromOss(
  imageId: string,
  mimeType: string
): Promise<Buffer | null> {
  if (!isOssEnabled()) return null;

  try {
    const client = await getOssClient();
    const result = await client.get(ossKey(imageId, mimeType));
    return Buffer.from(result.content);
  } catch {
    return null;
  }
}

/**
 * 构建图片 data URL
 * 优先从 OSS 获取，回退到数据库存储
 * @returns data URL 字符串，如果图片不存在返回 null
 */
export async function buildImageDataUrl(image: {
  id: string;
  data: Uint8Array | Buffer;
  mimeType: string;
}): Promise<string | null> {
  // 优先尝试 OSS
  if (isOssEnabled()) {
    const ossBuffer = await downloadImageFromOss(image.id, image.mimeType);
    if (ossBuffer && ossBuffer.length > 0) {
      return `data:${image.mimeType};base64,${ossBuffer.toString("base64")}`;
    }
  }

  // 回退到数据库存储
  const buf = image.data instanceof Uint8Array ? image.data : Buffer.from(image.data);
  if (buf && buf.length > 0) {
    return `data:${image.mimeType};base64,${buf.toString("base64")}`;
  }

  return null;
}
