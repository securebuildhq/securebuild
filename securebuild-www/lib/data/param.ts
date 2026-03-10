interface Params {
  isLoaded: boolean;
  DBUri: string;
  authMethod?: string;
  DB_URI: string;
}

const params: Params = {
  isLoaded: false,
  DBUri: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
  DB_URI: process.env["SECUREBUILD_PG_URI"] || process.env["DB_URI"]!,
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
    default:
      throw new Error(`unknown param ${key}`);
  }
}
