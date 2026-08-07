interface Params {
  isLoaded: boolean;
  DBUri: string;
  authMethod?: string;
  DB_URI: string;
  R2_ACCESS_KEY: string;
  R2_SECRET_KEY: string;
  R2_ENDPOINT: string;
  R2_IMAGE_SCANS_BUCKET_NAME: string;
  R2_USE_DYNAMIC_FOLDER: string;
}

const params: Params = {
  isLoaded: false,
  DBUri: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  DB_URI: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  R2_ACCESS_KEY: process.env["R2_ACCESS_KEY"] || "",
  R2_SECRET_KEY: process.env["R2_SECRET_KEY"] || "",
  R2_ENDPOINT: process.env["R2_ENDPOINT"] || "",
  R2_IMAGE_SCANS_BUCKET_NAME: process.env["R2_IMAGE_SCANS_BUCKET_NAME"] || "",
  R2_USE_DYNAMIC_FOLDER: process.env["R2_USE_DYNAMIC_FOLDER"] || "true",
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
    case "R2_ACCESS_KEY":
      return params.R2_ACCESS_KEY;
    case "R2_SECRET_KEY":
      return params.R2_SECRET_KEY;
    case "R2_ENDPOINT":
      return params.R2_ENDPOINT;
    case "R2_IMAGE_SCANS_BUCKET_NAME":
      return params.R2_IMAGE_SCANS_BUCKET_NAME;
    case "R2_USE_DYNAMIC_FOLDER":
      return params.R2_USE_DYNAMIC_FOLDER;
    default:
      throw new Error(`unknown param ${key}`);
  }
}
