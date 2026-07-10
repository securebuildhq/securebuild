"use client"

import { useState, useEffect } from "react"
import { useSession } from "@/app/hooks/use-session"
import { listSystemTokensAction, createSystemTokenAction } from "@/lib/team/actions/system-tokens"
import { deleteSystemTokenAction as deleteToken } from "@/lib/team/actions/delete-system-token"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Key, Plus, Trash2, Loader2, Copy, Check } from "lucide-react"

interface SystemToken {
  id: string
  name: string
  partialValue: string
  expiresAt: Date | null
  expiresIn: string | null
  lastUsedAt: Date | null
  createdAt: Date
}

export default function SystemTokensPage() {
  const { session, isSessionLoading } = useSession()
  const [tokens, setTokens] = useState<SystemToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTokenName, setNewTokenName] = useState("")
  const [newTokenExpiry, setNewTokenExpiry] = useState("never")
  const [isCreating, setIsCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchTokens = async () => {
    if (!session) return
    try {
      setLoading(true)
      const data = await listSystemTokensAction(session)
      setTokens(data)
    } catch (err) {
      console.error("Failed to fetch system tokens:", err)
      setError("Failed to load system tokens")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!session) return
    fetchTokens()
  }, [session])

  const handleCreate = async () => {
    if (!session || !newTokenName.trim()) return
    setIsCreating(true)
    setError(null)
    try {
      const result = await createSystemTokenAction(session, newTokenName.trim(), newTokenExpiry)
      setCreatedToken(result.value)
      setNewTokenName("")
      setNewTokenExpiry("never")
      setCreateOpen(false)
      await fetchTokens()
    } catch (err) {
      console.error("Failed to create system token:", err)
      setError("Failed to create system token")
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!session || !deleteId) return
    setIsDeleting(true)
    setError(null)
    try {
      await deleteToken(session, deleteId)
      await fetchTokens()
      setDeleteConfirmOpen(false)
      setDeleteId(null)
    } catch (err) {
      console.error("Failed to delete system token:", err)
      setError("Failed to delete system token")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCopy = () => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const closeCreatedDialog = () => {
    setCreatedToken(null)
    setCopied(false)
    setCreateOpen(false)
  }

  if (isSessionLoading || !session) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6" />
            System Tokens
          </h1>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setNewTokenName("")
            setNewTokenExpiry("never")
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Token
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create System Token</DialogTitle>
              <DialogDescription>
                System tokens grant system-level access to trigger package builds across all package families.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="e.g., CI Pipeline Token"
                />
              </div>
              <div className="space-y-2">
                <Label>Expiry</Label>
                <Select value={newTokenExpiry} onValueChange={setNewTokenExpiry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={isCreating || !newTokenName.trim()}>
                {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {createdToken && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Token created successfully. Copy it now — it won&apos;t be shown again.
              </p>
              <p className="mt-2 text-sm font-mono text-green-900 dark:text-green-200 break-all">
                {createdToken}
              </p>
            </div>
            <div className="flex gap-2 ml-4">
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="outline" onClick={closeCreatedDialog}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>System Service Account Tokens</CardTitle>
          <CardDescription>
            Tokens with system-level access for triggering package builds via the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-600 dark:text-slate-400">No system tokens created yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Token Preview</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">{token.name}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-500">{token.partialValue}...</TableCell>
                    <TableCell>{new Date(token.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "Never"}</TableCell>
                    <TableCell>
                      {token.expiresIn === "never" ? "Never" : token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setDeleteId(token.id)
                          setDeleteConfirmOpen(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete System Token</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this system token? This action cannot be undone.
              Any services using this token will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
