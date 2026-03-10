interface Params {
  isLoaded: boolean;
  DBUri: string;
  authMethod?: string;
  DB_URI: string;
  REPLICATED_API_ORIGIN: string;
  REPLICATED_API_TOKEN: string;
  CVE0_OCI_HOST: string;
  PIPELINE_DIR: string;
}

const params: Params = {
  isLoaded: false,
  DBUri: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  DB_URI: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  REPLICATED_API_ORIGIN: process.env["REPLICATED_API_ORIGIN"]!,
  REPLICATED_API_TOKEN: process.env["REPLICATED_API_TOKEN"]!,
  CVE0_OCI_HOST: process.env["CVE0_OCI_HOST"]!,
  PIPELINE_DIR: process.env["PIPELINE_DIR"]!,
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
    case "CVE0_OCI_HOST":
      return params.CVE0_OCI_HOST;
    case "PIPELINE_DIR":
      return params.PIPELINE_DIR;
    default:
      throw new Error(`unknown param ${key}`);
  }
}
