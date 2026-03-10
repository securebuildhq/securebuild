export const FEATURE_FLAGS = {
  CUSTOM_MELANGE_UPLOAD: "custom-melange-upload",
  CUSTOM_APKO_UPLOAD: "custom-apko-upload"
} as const;

export type FeatureFlag = typeof FEATURE_FLAGS[keyof typeof FEATURE_FLAGS];

export const AVAILABLE_FEATURE_FLAGS = [
  {
    key: FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD,
    name: "Custom Melange Upload",
    description: "Allow team members to upload custom melange files"
  },
  {
    key: FEATURE_FLAGS.CUSTOM_APKO_UPLOAD,
    name: "Custom APKO Upload", 
    description: "Allow team members to upload custom APKO files"
  }
];