export type PipelineType = 'package' | 'image'

export interface Pipeline {
  id: string
  pipelineType: PipelineType // Distinguishes package vs image pipelines
  path: string // e.g., "test/smoke-binary" or "build/autoconf"
  yamlContent: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface CreatePipelineRequest {
  pipelineType: PipelineType // Distinguishes package vs image pipelines
  path: string // e.g., "test/smoke-binary" or "build/autoconf"
  yamlContent: string
  description?: string
}

export interface UpdatePipelineRequest {
  path: string // e.g., "test/smoke-binary" or "build/autoconf"
  yamlContent: string
  description?: string
}
