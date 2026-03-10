import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { ServiceAccount, ServiceAccountWithValue } from "@/lib/types/service-account";
import { Edit, RefreshCw, Trash2, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";

interface ServiceAccountRowProps {
  serviceAccount: ServiceAccount | ServiceAccountWithValue;
  handleRenameSecret: (serviceAccount: ServiceAccount | ServiceAccountWithValue) => void;
  handleRotateSecret: (serviceAccount: ServiceAccount | ServiceAccountWithValue) => void;
  handleDeleteSecret: (serviceAccount: ServiceAccount | ServiceAccountWithValue) => void;
}

export const ServiceAccountRow: React.FC<ServiceAccountRowProps> = ({
  serviceAccount,
  handleRenameSecret,
  handleRotateSecret,
  handleDeleteSecret,
}) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  return (
    <TableRow key={serviceAccount.id}>
      <TableCell className="font-medium">{serviceAccount.name}</TableCell>
      <TableCell>
        <div className="flex items-center w-full space-x-2">
          {'value' in serviceAccount && serviceAccount.value ? (
            <>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="font-mono text-sm bg-muted text-muted-foreground p-2 rounded break-all flex-1 min-w-0">
                  {serviceAccount.value}
                </span>
                <p className="text-xs italic text-muted-foreground mt-1">
                  This secret will not be shown again. Copy it now.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  // Type guard ensures 'value' exists and is truthy.
                  // Casting for clarity within the event handler.
                  navigator.clipboard.writeText((serviceAccount as ServiceAccountWithValue).value)
                    .then(() => {
                      toast({ title: 'Copied to clipboard' });
                      setCopied(true);
                      if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                      }
                      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
                    })
                    .catch((err) => {
                      console.error('Failed to copy access token: ', err);
                      toast({ title: 'Failed to copy access token', variant: 'destructive' });
                    });
                }}
                title="Copy secret value"
                className="shrink-0" // Prevents the button from shrinking
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </>
          ) : (
            <span>{serviceAccount.partialValue}...</span>
          )}
        </div>
      </TableCell>
      <TableCell>{serviceAccount.lastUsedAt ? serviceAccount.lastUsedAt.toLocaleDateString() : "Never"}</TableCell>
      <TableCell>{serviceAccount.expiresAt ? serviceAccount.expiresAt.toLocaleDateString() : "Never"}</TableCell>
      <TableCell>{serviceAccount.createdAt.toLocaleDateString()}</TableCell>
      <TableCell className="text-right space-x-2">
        <Button variant="outline" size="sm" onClick={() => handleRenameSecret(serviceAccount)} title="Rename secret">
          <Edit className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleRotateSecret(serviceAccount)} title="Rotate secret">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="destructive" size="sm" onClick={() => handleDeleteSecret(serviceAccount)} title="Delete secret">
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
};
