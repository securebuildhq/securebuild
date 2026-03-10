import { CatalogItem } from "./catalog";

export type Image = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: Date;

  defaultTag: string;
  defaultTagReadme: string | null;

  tags: string[];

  catalogItem?: CatalogItem;

  vulnerabilitiesFixed: number;
  lastBuiltAt: string;
  lastScannedAt: string;
}


