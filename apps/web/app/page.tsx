import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Phase 0 placeholder landing page. Track A/B replace this with the real
// authenticated dashboard once their routes land under app/(dashboard)/.
export default function Home() {
  return (
    <main className="container mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 py-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pikorua HRM</h1>
        <p className="mt-2 text-muted-foreground">
          Phase 0 foundation is in place. Feature tracks build from here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Track A — People, Time &amp; Money</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Employees, departments/teams, attendance (manual clock-in/out +
            HR/Admin approval), payroll &amp; payslips.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Track B — Work, Requests &amp; Culture</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Work units/tasks, daily planning &amp; EOD, requests, recognition,
            notifications, announcements, documents, events.
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
