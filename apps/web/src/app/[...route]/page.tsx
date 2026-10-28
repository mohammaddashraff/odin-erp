import { notFound, redirect } from "next/navigation";
import { allRoutes, legacyRedirects } from "../../core/navigation";
import Workspace from "../../components/workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ route: string[] }>;
}) {
  const { route } = await params;
  const path = "/" + route.join("/");
  if (legacyRedirects[path]) redirect(legacyRedirects[path]);
  if (!allRoutes.some(({ child }) => child.route === path) && path !== "/login" && !/^\/settings\/access\/users\/\d+$/.test(path))
    notFound();
  return <Workspace route={path} />;
}
