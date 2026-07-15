import { WorkUnitDetailScreen } from "@/components/work/work-unit-detail-screen";

export default function WorkUnitDetailPage({ params }: { params: { id: string } }) {
  return <WorkUnitDetailScreen workUnitId={params.id} />;
}
