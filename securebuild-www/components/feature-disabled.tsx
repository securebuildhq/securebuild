import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface FeatureDisabledProps {
  featureName: string;
  description?: string;
}

export function FeatureDisabled({ featureName, description }: FeatureDisabledProps) {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{featureName}</h1>
        {description && (
          <p className="text-muted-foreground mt-2">{description}</p>
        )}
      </div>

      <Card>
        <CardContent className="p-12">
          <div className="text-center space-y-4">
            <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <h3 className="text-lg font-semibold">Feature Not Enabled</h3>
              <p className="text-muted-foreground">
                The {featureName.toLowerCase()} feature is not enabled for your team.
              </p>
              <p className="text-muted-foreground mt-2">
                Please contact your team administrator to enable this feature.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}