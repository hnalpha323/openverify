import { THEMES_COPY } from '../../../lib/copy/themes-copy';
import { PageLoading } from '../../../components/page-loading';

export default function ThemeSetsLoading() {
  return <PageLoading label={THEMES_COPY.list.loading} />;
}
