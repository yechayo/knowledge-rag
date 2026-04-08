declare module "ali-oss" {
  interface OSSOptions {
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    region?: string;
    endpoint?: string;
  }

  interface PutObjectResult {
    name: string;
    url: string;
    res: Record<string, any>;
  }

  interface GetObjectResult {
    content: Buffer;
    contentLength: number;
    contentType: string;
    res: Record<string, any>;
  }

  class OSS {
    constructor(options: OSSOptions);
    put(name: string, file: Buffer | string | ReadableStream, options?: Record<string, any>): Promise<PutObjectResult>;
    get(name: string, options?: Record<string, any>): Promise<GetObjectResult>;
    delete(name: string): Promise<any>;
    head(name: string): Promise<any>;
    list(options?: Record<string, any>): Promise<any>;
    signatureUrl(name: string, options?: Record<string, any>): string;
  }

  export default OSS;
}
