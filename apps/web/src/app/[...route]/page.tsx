import { notFound, redirect } from 'next/navigation';
import { getRequestLanguage } from '../i18n-server';
import { allRoutes, legacyRedirects } from '../navigation';
import OdinApp from '../odin-app';

export default async function RoutePage({ params }: { params: Promise<{ route: string[] }> }) {
  const [{ route }, language] = await Promise.all([params, getRequestLanguage()]);
  const pathname = `/${route.join('/')}`;
  const replacement = legacyRedirects[pathname];

  if (replacement) redirect(replacement);
  if (!allRoutes.some(({ child }) => child.route === pathname)) notFound();

  return <OdinApp initialRoute={pathname} initialLanguage={language}/>;
}
