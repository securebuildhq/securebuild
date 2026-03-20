interface Params {
  isLoaded: boolean;
  DBUri: string;
  DB_URI: string;
  REPLICATED_API_ORIGIN: string;
  REPLICATED_API_TOKEN: string;
  REGISTRY_IMAGE_PREFIX: string;
  OCI_IMAGE_PREFIX: string;
  PIPELINE_DIR: string;
  AUTH_METHOD?: string;
  ADMIN_GITHUB_ORG?: string;
  APP_ORIGIN?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
}

const params: Params = {
  isLoaded: false,
  DBUri: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  DB_URI: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  REPLICATED_API_ORIGIN: process.env["REPLICATED_API_ORIGIN"]!,
  REPLICATED_API_TOKEN: process.env["REPLICATED_API_TOKEN"]!,
  REGISTRY_IMAGE_PREFIX: process.env["REGISTRY_IMAGE_PREFIX"]!,
  OCI_IMAGE_PREFIX: process.env["OCI_IMAGE_PREFIX"] || "",
  PIPELINE_DIR: process.env["PIPELINE_DIR"]!,
  AUTH_METHOD: process.env["AUTH_METHOD"],
  ADMIN_GITHUB_ORG: process.env["ADMIN_GITHUB_ORG"] || "",
  APP_ORIGIN: process.env["APP_ORIGIN"] || "",
  SMTP_HOST: process.env["SMTP_HOST"] || "",
  SMTP_PORT: process.env["SMTP_PORT"] || "587",
  SMTP_USER: process.env["SMTP_USER"] || "",
  SMTP_PASSWORD: process.env["SMTP_PASSWORD"] || "",
  SMTP_FROM: process.env["SMTP_FROM"] || "",
};

export async function loadParams() {
  params.isLoaded = true;
}

export async function getParam(key: keyof Params): Promise<string> {
  if (!params.isLoaded) {
    await loadParams();
  }

  switch (key) {
    case "DB_URI":
    case "DBUri":
      return params.DBUri;
    case "REPLICATED_API_ORIGIN":
      return params.REPLICATED_API_ORIGIN;
    case "REPLICATED_API_TOKEN":
      return params.REPLICATED_API_TOKEN;
    case "REGISTRY_IMAGE_PREFIX":
      return params.REGISTRY_IMAGE_PREFIX;
    case "OCI_IMAGE_PREFIX":
      return params.OCI_IMAGE_PREFIX;
    case "PIPELINE_DIR":
      return params.PIPELINE_DIR;
    case "ADMIN_GITHUB_ORG":
      return params.ADMIN_GITHUB_ORG!;
    case "APP_ORIGIN":
      return params.APP_ORIGIN!;
    case "SMTP_HOST":
      return params.SMTP_HOST!;
    case "SMTP_PORT":
      return params.SMTP_PORT!;
    case "SMTP_USER":
      return params.SMTP_USER!;
    case "SMTP_PASSWORD":
      return params.SMTP_PASSWORD!;
    case "SMTP_FROM":
      return params.SMTP_FROM!;
    default:
      throw new Error(`unknown param ${key}`);
  }
}
