export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  isActive?: boolean;
  createdAt: string;

  category: string;
  slug: string;
  imageUrl: string;

  pricing: {
    monthly: number;
    yearly: number;
  }

  isPartner: boolean;
  isAlternativeBuild: boolean;

  stripeProductId: string;

  images: CatalogItemImage[];
}

export interface CatalogItemImageAPKO {
  id: string;
  name: string;
  tags: string[];
  buildStatus: "success" | "failed" | "building" | "pending" | "no-builds";
  lastBuiltAt: string | null;
}

export interface CatalogItemImage {
  imageId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  apkos: CatalogItemImageAPKO[];
  overallBuildStatus: "success" | "failed" | "building" | "pending" | "no-builds";
}


