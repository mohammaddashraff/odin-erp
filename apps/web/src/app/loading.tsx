import { PageSkeleton } from './ui-system';
import { getRequestLanguage } from './i18n-server';
import { t } from './i18n';

export default async function Loading() {
  const language = await getRequestLanguage();
  return <PageSkeleton variant="dashboard" label={t('Loading Odin ERP…', language)}/>;
}
