export type CatalogPricing = {
  monthly: number;
  yearly: number;
}

export type Image = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  slug: string;
  category: string;
  imageUrl: string;

  isPartner: boolean;
  isAlternativeBuild: boolean;

  pricing: CatalogPricing;

  cvesFixedCount: number;

  tagCount: number;
  lastBuiltAt: string;
  lastScannedAt?: string;
  license: string;
  images: Image[];
}

