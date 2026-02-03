import GroupLayoutPreview from '@/app/(presentation-generator)/template-preview/components/TemplatePreviewClient';
export async function generateStaticParams() {
  // Pre-render built-in template routes at build time
  return [
    { slug: 'general' },
    { slug: 'modern' },
    { slug: 'standard' },
    { slug: 'swift' },
  ];
}
export default function GroupLayoutPreviewPage() {
  return <GroupLayoutPreview />;
}