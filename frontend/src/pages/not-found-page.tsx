import { Link } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pageRoutes } from "@/lib/routes";

export function NotFoundPage({
  message = "找不到这个页面，请选择左侧菜单继续。",
}: {
  message?: string;
}) {
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        {message}
        <Button variant="outline" size="sm" asChild>
          <Link href={pageRoutes.overview.path}>返回概览</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
