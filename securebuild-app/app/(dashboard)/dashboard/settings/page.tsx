"use client"

import type React from "react"

import { useState } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Bell, Key, User, Wrench, Moon, Sun, Github, Copy, Check, Trash2, Plus, RefreshCw } from "lucide-react"
import { useSession } from "@/app/hooks/use-session"

// Mock API keys
const mockApiKeys = [
  {
    id: "key_1",
    name: "Development Key",
    key: "sb_dev_a1b2c3d4e5f6g7h8i9j0",
    created: "2023-04-15T10:30:00Z",
    lastUsed: "2023-05-20T14:22:00Z",
  },
  {
    id: "key_2",
    name: "CI/CD Integration",
    key: "sb_cicd_j9i8h7g6f5e4d3c2b1a0",
    created: "2023-05-01T09:15:00Z",
    lastUsed: "2023-05-22T08:45:00Z",
  },
]

export default function SettingsPage() {
  const { session, isSessionLoading } = useSession();
  const user = session?.user;
  const [apiKeys, setApiKeys] = useState(mockApiKeys)
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    buildSuccess: true,
    buildFailure: true,
    securityAlerts: true,
    weeklyDigest: false,
  })
  const [pipelineDefaults, setPipelineDefaults] = useState({
    autoTrigger: false,
    retryOnFailure: false,
    maxRetries: 3,
    timeout: 30,
  })
  const [theme, setTheme] = useState("system")
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)

  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>;
  }

  // Handle form submissions
  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // In a real app, this would call an API to update the user profile
    console.log("Profile updated")
  }

  const handleNotificationsSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // In a real app, this would call an API to update notification settings
    console.log("Notification settings updated")
  }

  const handlePipelineDefaultsSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // In a real app, this would call an API to update pipeline defaults
    console.log("Pipeline defaults updated")
  }

  // Handle API key copy
  const handleCopyKey = (keyId: string, keyValue: string) => {
    navigator.clipboard.writeText(keyValue)
    setCopiedKeyId(keyId)
    setTimeout(() => setCopiedKeyId(null), 2000)
  }

  // Handle API key deletion
  const handleDeleteKey = (keyId: string) => {
    setApiKeys(apiKeys.filter((key) => key.id !== keyId))
  }

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date)
  }

  return (
    <div className="p-6">
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div>
              <h1 className="text-3xl font-bold">Settings</h1>
              <p className="text-muted-foreground">Manage your account and preferences</p>
            </div>
          </div>

          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
              <TabsTrigger value="profile" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="hidden md:inline">Profile</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                <span className="hidden md:inline">Notifications</span>
              </TabsTrigger>
              <TabsTrigger value="api-keys" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                <span className="hidden md:inline">API Keys</span>
              </TabsTrigger>
              <TabsTrigger value="pipeline-defaults" className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                <span className="hidden md:inline">Pipeline Defaults</span>
              </TabsTrigger>
              <TabsTrigger value="appearance" className="flex items-center gap-2">
                <Moon className="h-4 w-4" />
                <span className="hidden md:inline">Appearance</span>
              </TabsTrigger>
            </TabsList>

            {/* Profile Settings */}
            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle>Profile Settings</CardTitle>
                  <CardDescription>Manage your personal information and account settings</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleProfileSubmit}>
                    <div className="flex flex-col md:flex-row gap-8">
                      <div className="flex flex-col items-center gap-4">
                        <Avatar className="h-24 w-24">
                          <AvatarImage src={user.imageUrl || "/placeholder.svg"} alt={user.name} />
                          <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <Button variant="outline" size="sm">
                          Change Avatar
                        </Button>
                      </div>
                      <div className="space-y-4 flex-1">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="name">Full Name</Label>
                            <Input
                              id="name"
                              value={user.name}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="username">Username</Label>
                            <Input
                              id="username"
                              value={user.name}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input
                            id="email"
                            type="email"
                            value={user.email}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>GitHub Connection</Label>
                          <div className="flex items-center gap-2 p-2 border rounded-md">
                            <Github className="h-5 w-5" />
                            <span className="font-medium">{user.name}</span>
                            <Badge variant="outline" className="ml-auto">
                              Connected
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </form>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="outline">Cancel</Button>
                  <Button onClick={handleProfileSubmit}>Save Changes</Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* Notification Settings */}
            <TabsContent value="notifications">
              <Card>
                <CardHeader>
                  <CardTitle>Notification Settings</CardTitle>
                  <CardDescription>Configure how and when you receive notifications</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleNotificationsSubmit}>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Email Notifications</Label>
                          <p className="text-sm text-muted-foreground">Receive notifications via email</p>
                        </div>
                        <Switch
                          checked={notifications.emailNotifications}
                          onCheckedChange={(checked) =>
                            setNotifications({ ...notifications, emailNotifications: checked })
                          }
                        />
                      </div>
                      <Separator />
                      <div className="space-y-4">
                        <Label>Pipeline Notifications</Label>
                        <div className="grid gap-3">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-sm">Build Success</Label>
                              <p className="text-xs text-muted-foreground">Notify when a pipeline execution succeeds</p>
                            </div>
                            <Switch
                              checked={notifications.buildSuccess}
                              onCheckedChange={(checked) =>
                                setNotifications({ ...notifications, buildSuccess: checked })
                              }
                              disabled={!notifications.emailNotifications}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-sm">Build Failure</Label>
                              <p className="text-xs text-muted-foreground">Notify when a pipeline execution fails</p>
                            </div>
                            <Switch
                              checked={notifications.buildFailure}
                              onCheckedChange={(checked) =>
                                setNotifications({ ...notifications, buildFailure: checked })
                              }
                              disabled={!notifications.emailNotifications}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-sm">Security Alerts</Label>
                              <p className="text-xs text-muted-foreground">Notify about security vulnerabilities</p>
                            </div>
                            <Switch
                              checked={notifications.securityAlerts}
                              onCheckedChange={(checked) =>
                                setNotifications({ ...notifications, securityAlerts: checked })
                              }
                              disabled={!notifications.emailNotifications}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-sm">Weekly Digest</Label>
                              <p className="text-xs text-muted-foreground">Receive a weekly summary of all activity</p>
                            </div>
                            <Switch
                              checked={notifications.weeklyDigest}
                              onCheckedChange={(checked) =>
                                setNotifications({ ...notifications, weeklyDigest: checked })
                              }
                              disabled={!notifications.emailNotifications}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </form>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="outline">Reset to Defaults</Button>
                  <Button onClick={handleNotificationsSubmit}>Save Changes</Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* API Keys */}
            <TabsContent value="api-keys">
              <Card>
                <CardHeader>
                  <CardTitle>API Keys</CardTitle>
                  <CardDescription>Manage API keys for integrating with SecureBuild</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <Label>Your API Keys</Label>
                      <p className="text-sm text-muted-foreground">
                        Use these keys to authenticate API requests from your applications
                      </p>
                    </div>

                    {apiKeys.length > 0 ? (
                      <div className="space-y-4">
                        {apiKeys.map((key) => (
                          <div key={key.id} className="p-4 border rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{key.name}</div>
                              <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={() => handleCopyKey(key.id, key.key)}>
                                  {copiedKeyId === key.id ? (
                                    <Check className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <Copy className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteKey(key.id)}>
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            </div>
                            <div className="font-mono text-sm bg-muted p-2 rounded">
                              {key.key.substring(0, 8)}•••••••••••••••••••
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <div>Created: {formatDate(key.created)}</div>
                              <div>Last used: {formatDate(key.lastUsed)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 border rounded-lg">
                        <Key className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">No API keys yet</p>
                      </div>
                    )}

                    <Button className="w-full">
                      <Plus className="h-4 w-4 mr-2" />
                      Generate New API Key
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Pipeline Defaults */}
            <TabsContent value="pipeline-defaults">
              <Card>
                <CardHeader>
                  <CardTitle>Pipeline Defaults</CardTitle>
                  <CardDescription>Configure default settings for new pipelines</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePipelineDefaultsSubmit}>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Auto-Trigger on Push</Label>
                          <p className="text-sm text-muted-foreground">
                            Automatically trigger pipelines on GitHub push events
                          </p>
                        </div>
                        <Switch
                          checked={pipelineDefaults.autoTrigger}
                          onCheckedChange={(checked) =>
                            setPipelineDefaults({ ...pipelineDefaults, autoTrigger: checked })
                          }
                        />
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Retry on Failure</Label>
                          <p className="text-sm text-muted-foreground">
                            Automatically retry failed pipeline executions
                          </p>
                        </div>
                        <Switch
                          checked={pipelineDefaults.retryOnFailure}
                          onCheckedChange={(checked) =>
                            setPipelineDefaults({ ...pipelineDefaults, retryOnFailure: checked })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="maxRetries">Maximum Retries</Label>
                          <Input
                            id="maxRetries"
                            type="number"
                            min="1"
                            max="10"
                            value={pipelineDefaults.maxRetries}
                            onChange={(e) =>
                              setPipelineDefaults({ ...pipelineDefaults, maxRetries: Number.parseInt(e.target.value) })
                            }
                            disabled={!pipelineDefaults.retryOnFailure}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="timeout">Execution Timeout (minutes)</Label>
                          <Input
                            id="timeout"
                            type="number"
                            min="5"
                            max="120"
                            value={pipelineDefaults.timeout}
                            onChange={(e) =>
                              setPipelineDefaults({ ...pipelineDefaults, timeout: Number.parseInt(e.target.value) })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </form>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="outline">Reset to Defaults</Button>
                  <Button onClick={handlePipelineDefaultsSubmit}>Save Changes</Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* Appearance */}
            <TabsContent value="appearance">
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>Customize the look and feel of the application</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <Label>Theme</Label>
                      <div className="grid grid-cols-3 gap-4">
                        <div
                          className={`border rounded-lg p-4 flex flex-col items-center gap-2 cursor-pointer hover:border-primary ${theme === "light" ? "border-primary bg-muted" : ""}`}
                          onClick={() => setTheme("light")}
                        >
                          <Sun className="h-6 w-6" />
                          <span>Light</span>
                        </div>
                        <div
                          className={`border rounded-lg p-4 flex flex-col items-center gap-2 cursor-pointer hover:border-primary ${theme === "dark" ? "border-primary bg-muted" : ""}`}
                          onClick={() => setTheme("dark")}
                        >
                          <Moon className="h-6 w-6" />
                          <span>Dark</span>
                        </div>
                        <div
                          className={`border rounded-lg p-4 flex flex-col items-center gap-2 cursor-pointer hover:border-primary ${theme === "system" ? "border-primary bg-muted" : ""}`}
                          onClick={() => setTheme("system")}
                        >
                          <RefreshCw className="h-6 w-6" />
                          <span>System</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <p className="text-sm text-muted-foreground">Theme preferences are saved automatically.</p>
                </CardFooter>
              </Card>
            </TabsContent>
          </Tabs>
    </div>
  )
}
