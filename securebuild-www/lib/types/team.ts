export interface Team {
  id: string;
  name: string;
  created_at?: string;
  stripe_customer_id?: string;
  paymentEmail?: string;
  registryUsername?: string;
  full_catalog_access?: boolean;
  feature_flags?: string[];
}