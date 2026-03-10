export enum ActivityEventType {
  ImagePull = "image_pull",
}

export interface Activity {
  eventType: ActivityEventType
  id: string;
  serviceAccountId?: string
  serviceAccountName?: string
  createdAt: string

  imageName?: string
  imageTag?: string

  isNew?: boolean
}


export interface ImageUsage {
  startDate: string
  endDate: string

  pulls: ImageUsagePull[]
}

export interface ImageUsagePull {
  imageName: string;
  imageTag: string;
  pullCount: number;
}