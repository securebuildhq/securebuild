"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Plus, Trash2, Search, X, Edit, Loader2, Package, Image as ImageIcon, Copy, Check } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useSession } from "@/app/hooks/use-session"
import {
  listPipelinesAction,
  createPipelineAction,
  updatePipelineAction,
  deletePipelineAction
} from "@/lib/pipeline/actions/pipeline-actions"
import { Pipeline } from "@/lib/types/pipeline"
import { extractPipelineNameFromYAML, validatePipelineInputNames } from "@/lib/pipeline/pipeline-utils"
import { ValidationError } from "@/lib/errors/validation-error"

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[400px] border rounded-md flex items-center justify-center bg-muted">
      <p className="text-muted-foreground">Loading editor...</p>
    </div>
  ),
})

export default function PipelinesPage() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [imageTestPipelines, setImageTestPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [imageTestLoading, setImageTestLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [imageTestSearchTerm, setImageTestSearchTerm] = useState("")

  // Create/Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImageTestModalOpen, setIsImageTestModalOpen] = useState(false)
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null)
  const [editingImageTestPipeline, setEditingImageTestPipeline] = useState<Pipeline | null>(null)
  const [modalPath, setModalPath] = useState("")
  const [modalDescription, setModalDescription] = useState("")
  const [modalYaml, setModalYaml] = useState("")
  const [imageTestModalPath, setImageTestModalPath] = useState("")
  const [imageTestModalDescription, setImageTestModalDescription] = useState("")
  const [imageTestModalYaml, setImageTestModalYaml] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)


  // Delete confirmation modal state
  const [selectedPipelineForDelete, setSelectedPipelineForDelete] = useState<Pipeline | null>(null)
  const [selectedImageTestPipelineForDelete, setSelectedImageTestPipelineForDelete] = useState<Pipeline | null>(null)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("")
  const [imageTestDeleteConfirmationText, setImageTestDeleteConfirmationText] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  // Copy to clipboard state
  const [copiedPipelineId, setCopiedPipelineId] = useState<string | null>(null)
  const [copiedImageTestPipelineId, setCopiedImageTestPipelineId] = useState<string | null>(null)

  // FIXME: Controlled tab state required due to React 19/Radix UI rendering issue
  const [activeTab, setActiveTab] = useState("package-tests")

  const filteredPipelines = useMemo(() => {
    if (!searchTerm) return pipelines
    return pipelines.filter(pipeline =>
      pipeline.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (pipeline.description && pipeline.description.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  }, [pipelines, searchTerm])

  const filteredImageTestPipelines = useMemo(() => {
    if (!imageTestSearchTerm) return imageTestPipelines
    return imageTestPipelines.filter(pipeline =>
      pipeline.path.toLowerCase().includes(imageTestSearchTerm.toLowerCase()) ||
      (pipeline.description && pipeline.description.toLowerCase().includes(imageTestSearchTerm.toLowerCase()))
    )
  }, [imageTestPipelines, imageTestSearchTerm])

  useEffect(() => {
    if (session) {
      fetchPipelines()
      fetchImageTestPipelines()
    }
  }, [session])

  const fetchPipelines = async () => {
    if (!session) return
    setLoading(true)
    try {
      const pipelinesData = await listPipelinesAction(session, 'package')
      setPipelines(pipelinesData)
    } catch (error) {
      console.error("Failed to fetch pipelines:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchImageTestPipelines = async () => {
    if (!session) return
    setImageTestLoading(true)
    try {
      const pipelinesData = await listPipelinesAction(session, 'image')
      setImageTestPipelines(pipelinesData)
    } catch (error) {
      console.error("Failed to fetch image test pipelines:", error)
    } finally {
      setImageTestLoading(false)
    }
  }

  const handleCreateClick = () => {
    setEditingPipeline(null)
    setModalPath("")
    setModalDescription("")
    setModalYaml("")
    setSubmitError(null)
    setIsModalOpen(true)
  }

  const handleEditClick = (pipeline: Pipeline) => {
    setEditingPipeline(pipeline)
    setModalPath(pipeline.path)
    setModalDescription(pipeline.description || "")
    setModalYaml(pipeline.yamlContent)
    setSubmitError(null)
    setIsModalOpen(true)
  }

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      if (!session) {
        throw new Error("No session found")
      }

      // Validate path is not empty
      if (!modalPath.trim()) {
        throw new ValidationError("Pipeline path cannot be empty")
      }

      // Validate path doesn't contain empty segments
      const pathParts = modalPath.trim().split('/')
      if (pathParts.length === 0 || pathParts.some(part => !part.trim())) {
        throw new ValidationError("Pipeline path cannot contain empty segments")
      }

      // Extract name from YAML to ensure it exists
      const yamlName = extractPipelineNameFromYAML(modalYaml)
      if (!yamlName) {
        throw new ValidationError("Pipeline YAML must include a 'name:' field at the top level")
      }

      // Validate input names if the pipeline has inputs
      validatePipelineInputNames(modalYaml)

      if (editingPipeline) {
        // Update existing pipeline
        await updatePipelineAction(session, editingPipeline.path, {
          path: modalPath.trim(),
          yamlContent: modalYaml,
          description: modalDescription || undefined,
        })
      } else {
        // Create new pipeline
        await createPipelineAction(session, {
          pipelineType: 'package',
          path: modalPath.trim(),
          yamlContent: modalYaml,
          description: modalDescription || undefined,
        })
      }

      setIsModalOpen(false)
      await fetchPipelines()
    } catch (error) {
      console.error("Failed to save pipeline:", error)
      setSubmitError(error instanceof Error ? error.message : "Failed to save pipeline")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteClick = (pipeline: Pipeline) => {
    setSelectedPipelineForDelete(pipeline)
    setDeleteConfirmationText("")
  }

  const handleDeleteConfirm = async () => {
    if (!selectedPipelineForDelete || !session) return
    if (deleteConfirmationText !== selectedPipelineForDelete.path) return

    setIsDeleting(true)
    try {
      await deletePipelineAction(session, selectedPipelineForDelete.path)
      setPipelines(pipelines.filter(p => p.path !== selectedPipelineForDelete.path))
      setSelectedPipelineForDelete(null)
      setDeleteConfirmationText("")
    } catch (error) {
      console.error("Failed to delete pipeline:", error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleClearSearch = () => {
    setSearchTerm("")
  }

  // Image Test Pipeline handlers
  const handleImageTestCreateClick = () => {
    setEditingImageTestPipeline(null)
    setImageTestModalPath("")
    setImageTestModalDescription("")
    setImageTestModalYaml("")
    setSubmitError(null)
    setIsImageTestModalOpen(true)
  }

  const handleImageTestEditClick = (pipeline: Pipeline) => {
    setEditingImageTestPipeline(pipeline)
    setImageTestModalPath(pipeline.path)
    setImageTestModalDescription(pipeline.description || "")
    setImageTestModalYaml(pipeline.yamlContent)
    setSubmitError(null)
    setIsImageTestModalOpen(true)
  }

  const handleImageTestModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      if (!session) {
        throw new Error("No session found")
      }

      // Validate path is not empty
      if (!imageTestModalPath.trim()) {
        throw new ValidationError("Pipeline path cannot be empty")
      }

      // Validate path doesn't contain empty segments
      const pathParts = imageTestModalPath.trim().split('/')
      if (pathParts.length === 0 || pathParts.some(part => !part.trim())) {
        throw new ValidationError("Pipeline path cannot contain empty segments")
      }

      // Extract name from YAML to ensure it exists
      const yamlName = extractPipelineNameFromYAML(imageTestModalYaml)
      if (!yamlName) {
        throw new ValidationError("Pipeline YAML must include a 'name:' field at the top level")
      }

      // Validate input names if the pipeline has inputs
      validatePipelineInputNames(imageTestModalYaml)

      if (editingImageTestPipeline) {
        // Update existing pipeline
        await updatePipelineAction(session, editingImageTestPipeline.path, {
          path: imageTestModalPath.trim(),
          yamlContent: imageTestModalYaml,
          description: imageTestModalDescription || undefined,
        }, 'image')
      } else {
        // Create new pipeline
        await createPipelineAction(session, {
          pipelineType: 'image',
          path: imageTestModalPath.trim(),
          yamlContent: imageTestModalYaml,
          description: imageTestModalDescription || undefined,
        })
      }

      setIsImageTestModalOpen(false)
      await fetchImageTestPipelines()
    } catch (error) {
      console.error("Failed to save image test pipeline:", error)
      setSubmitError(error instanceof Error ? error.message : "Failed to save image test pipeline")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleImageTestDeleteClick = (pipeline: Pipeline) => {
    setSelectedImageTestPipelineForDelete(pipeline)
    setImageTestDeleteConfirmationText("")
  }

  const handleImageTestDeleteConfirm = async () => {
    if (!selectedImageTestPipelineForDelete || !session) return
    if (imageTestDeleteConfirmationText !== selectedImageTestPipelineForDelete.path) return

    setIsDeleting(true)
    try {
      await deletePipelineAction(session, selectedImageTestPipelineForDelete.path, 'image')
      setImageTestPipelines(imageTestPipelines.filter(p => p.path !== selectedImageTestPipelineForDelete.path))
      setSelectedImageTestPipelineForDelete(null)
      setImageTestDeleteConfirmationText("")
    } catch (error) {
      console.error("Failed to delete image test pipeline:", error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleImageTestClearSearch = () => {
    setImageTestSearchTerm("")
  }

  const formatCompactDate = (dateInput: any) => {
    if (!dateInput) return "—"

    try {
      let date: Date;
      if (dateInput instanceof Date) {
        date = dateInput;
      } else {
        date = new Date(dateInput);
      }

      if (isNaN(date.getTime())) {
        return "Invalid";
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
      }
    } catch (error) {
      return "Invalid";
    }
  }

  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return "—"
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + "..."
  }

  const handleCopyUsesDeclaration = async (pipeline: Pipeline) => {
    const usesDeclaration = `uses: ${pipeline.path}`
    try {
      await navigator.clipboard.writeText(usesDeclaration)
      setCopiedPipelineId(pipeline.id)
      setTimeout(() => setCopiedPipelineId(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleImageTestCopyUsesDeclaration = async (pipeline: Pipeline) => {
    const usesDeclaration = `uses: ${pipeline.path}`
    try {
      await navigator.clipboard.writeText(usesDeclaration)
      setCopiedImageTestPipelineId(pipeline.id)
      setTimeout(() => setCopiedImageTestPipelineId(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Pipelines</h1>
          <p className="text-muted-foreground">Manage reusable pipeline configurations for packages and image testing.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="package-tests" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Packages
          </TabsTrigger>
          <TabsTrigger value="image-tests" className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Image Tests
          </TabsTrigger>
        </TabsList>

        {/* FIXME: key prop required due to React 19/Radix UI rendering issue - content not updating without it */}
        <TabsContent value="package-tests" className="space-y-6" key="package-tests-content">
          {loading && pipelines.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                <div>Loading pipelines...</div>
              </div>
            </div>
          ) : (
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-foreground">
                  Reusable pipelines for building and testing packages. Copy and paste the uses: key into your melange.yaml pipeline using the copy/paste actions button.
                </p>
                <Button onClick={handleCreateClick}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Pipeline
                </Button>
              </div>

              {/* Search bar */}
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search package pipelines..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-10"
                  />
                  {searchTerm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearSearch}
                      className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Pipelines Table */}
              {filteredPipelines.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <h3 className="text-lg font-semibold mb-2">
                    {searchTerm ? "No pipelines found" : "No pipelines yet"}
                  </h3>
                  <p className="text-muted-foreground mb-4 max-w-sm">
                    {searchTerm
                      ? `No pipelines match "${searchTerm}". Try adjusting your search.`
                      : "Get started by creating your pipeline configuration."
                    }
                  </p>
                  {!searchTerm && (
                    <Button onClick={handleCreateClick}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create First Pipeline
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">Pipeline Path</TableHead>
                        <TableHead className="w-auto">Description</TableHead>
                        <TableHead className="w-[140px]">Created</TableHead>
                        <TableHead className="w-[140px]">Updated</TableHead>
                        <TableHead className="w-[120px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPipelines.map((pipeline) => (
                        <TableRow key={pipeline.id}>
                          <TableCell className="font-medium">
                            <button
                              onClick={() => handleEditClick(pipeline)}
                              className="text-left hover:text-blue-600 hover:underline cursor-pointer font-mono"
                            >
                              {pipeline.path}
                            </button>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {truncateText(pipeline.description, 80)}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {formatCompactDate(pipeline.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {formatCompactDate(pipeline.updatedAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCopyUsesDeclaration(pipeline)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-green-600"
                                title={`Copy uses: ${pipeline.path}`}
                              >
                                {copiedPipelineId === pipeline.id ? (
                                  <Check className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditClick(pipeline)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-blue-600"
                                title="Edit"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteClick(pipeline)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* FIXME: key prop required due to React 19/Radix UI rendering issue - content not updating without it */}
        <TabsContent value="image-tests" className="space-y-6" key="image-tests-content">
          {imageTestLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-foreground">
                  Reusable image test pipeline configurations. Copy and paste the uses: key into your apko.test.yaml pipeline using the copy/paste actions button.
                </p>
                <Button onClick={handleImageTestCreateClick}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Pipeline
                </Button>
              </div>

              {/* Search bar */}
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search image test pipelines..."
                    value={imageTestSearchTerm}
                    onChange={(e) => setImageTestSearchTerm(e.target.value)}
                    className="pl-10 pr-10"
                  />
                  {imageTestSearchTerm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleImageTestClearSearch}
                      className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Image Test Pipelines Table */}
              {filteredImageTestPipelines.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <h3 className="text-lg font-semibold mb-2">
                    {imageTestSearchTerm ? "No image test pipelines found" : "No image test pipelines yet"}
                  </h3>
                  <p className="text-muted-foreground mb-4 max-w-sm">
                    {imageTestSearchTerm
                      ? `No image test pipelines match "${imageTestSearchTerm}". Try adjusting your search.`
                      : "Get started by creating your first image test pipeline configuration."
                    }
                  </p>
                  {!imageTestSearchTerm && (
                    <Button onClick={handleImageTestCreateClick}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create First Pipeline
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">Pipeline Path</TableHead>
                        <TableHead className="w-auto">Description</TableHead>
                        <TableHead className="w-[140px]">Created</TableHead>
                        <TableHead className="w-[140px]">Updated</TableHead>
                        <TableHead className="w-[120px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredImageTestPipelines.map((pipeline) => (
                        <TableRow key={pipeline.id}>
                          <TableCell className="font-medium">
                            <button
                              onClick={() => handleImageTestEditClick(pipeline)}
                              className="text-left hover:text-blue-600 hover:underline cursor-pointer font-mono"
                            >
                              {pipeline.path}
                            </button>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {truncateText(pipeline.description, 80)}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {formatCompactDate(pipeline.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {formatCompactDate(pipeline.updatedAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleImageTestCopyUsesDeclaration(pipeline)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-green-600"
                                title={`Copy uses: ${pipeline.path}`}
                              >
                                {copiedImageTestPipelineId === pipeline.id ? (
                                  <Check className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleImageTestEditClick(pipeline)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-blue-600"
                                title="Edit"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleImageTestDeleteClick(pipeline)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPipeline ? "Edit Pipeline" : "Create Pipeline"}</DialogTitle>
            <DialogDescription>
              {editingPipeline
                ? "Update the pipeline YAML configuration and description."
                : "Create a new pipeline with YAML configuration."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleModalSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="path">Pipeline Path</Label>
              <Input
                id="path"
                value={modalPath}
                onChange={(e) => setModalPath(e.target.value)}
                placeholder="e.g., test/smoke-binary or build/autoconf"
                required
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={modalDescription}
                onChange={(e) => setModalDescription(e.target.value)}
                placeholder="Brief description of this pipeline"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>YAML Content</Label>
              <div className="border rounded-md overflow-hidden">
                <MonacoEditor
                  height="400px"
                  language="yaml"
                  theme="vs-dark"
                  value={modalYaml}
                  onChange={(value) => setModalYaml(value || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>

            {submitError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                {submitError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  editingPipeline ? "Update Pipeline" : "Create Pipeline"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <AlertDialog open={!!selectedPipelineForDelete} onOpenChange={() => setSelectedPipelineForDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pipeline</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the test pipeline
              <strong className="font-semibold"> {selectedPipelineForDelete?.path}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4">
            <label htmlFor="delete-confirmation" className="text-sm font-medium">
              Please type <strong className="font-mono">{selectedPipelineForDelete?.path}</strong> to confirm:
            </label>
            <Input
              id="delete-confirmation"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder={selectedPipelineForDelete?.path}
              className="mt-2 font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteConfirmationText !== selectedPipelineForDelete?.path || isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Pipeline"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image Test Create/Edit Modal */}
      <Dialog open={isImageTestModalOpen} onOpenChange={setIsImageTestModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingImageTestPipeline ? "Edit Image Test Pipeline" : "Create Image Test Pipeline"}</DialogTitle>
            <DialogDescription>
              {editingImageTestPipeline
                ? "Update the image test pipeline YAML configuration and description. Pipelines can define inputs that are passed via with: syntax when using uses: key."
                : "Create a new image test pipeline with YAML configuration. Pipelines can define inputs that are passed via with: syntax when using uses: key."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleImageTestModalSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="image-test-path">Pipeline Path</Label>
              <Input
                id="image-test-path"
                value={imageTestModalPath}
                onChange={(e) => setImageTestModalPath(e.target.value)}
                placeholder="e.g., smoke/basic or integration/full"
                required
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="image-test-description">Description (optional)</Label>
              <Textarea
                id="image-test-description"
                value={imageTestModalDescription}
                onChange={(e) => setImageTestModalDescription(e.target.value)}
                placeholder="Brief description of this image test pipeline"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>YAML Content</Label>
              <div className="border rounded-md overflow-hidden">
                <MonacoEditor
                  height="400px"
                  language="yaml"
                  theme="vs-dark"
                  value={imageTestModalYaml}
                  onChange={(value) => setImageTestModalYaml(value || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>

            {submitError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                {submitError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsImageTestModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  editingImageTestPipeline ? "Update Pipeline" : "Create Pipeline"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Image Test Delete Confirmation Modal */}
      <AlertDialog open={!!selectedImageTestPipelineForDelete} onOpenChange={() => setSelectedImageTestPipelineForDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image Test Pipeline</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the image test pipeline
              <strong className="font-semibold"> {selectedImageTestPipelineForDelete?.path}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4">
            <label htmlFor="image-test-delete-confirmation" className="text-sm font-medium">
              Please type <strong className="font-mono">{selectedImageTestPipelineForDelete?.path}</strong> to confirm:
            </label>
            <Input
              id="image-test-delete-confirmation"
              value={imageTestDeleteConfirmationText}
              onChange={(e) => setImageTestDeleteConfirmationText(e.target.value)}
              placeholder={selectedImageTestPipelineForDelete?.path}
              className="mt-2 font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleImageTestDeleteConfirm}
              disabled={imageTestDeleteConfirmationText !== selectedImageTestPipelineForDelete?.path || isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Pipeline"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
