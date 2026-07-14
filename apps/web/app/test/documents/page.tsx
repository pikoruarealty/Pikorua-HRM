"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "../_lib/api";

type Document = { id: string; docType: string; fileUrl: string; uploadedAt: string };
type Employee = { id: string; fullName: string; role: string };

// Files are uploaded as real bytes (multipart/form-data) and saved to local
// disk on the server via lib/storage/local.ts — no S3/cloud dependency,
// matching the planned GCP-VM deployment.
export default function DocumentsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [docType, setDocType] = useState("ID Proof");
  const [file, setFile] = useState<File | null>(null);
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/test/employees").then((r) => r.json()).then((json) => {
      if (json.data) setEmployees(json.data);
    });
  }, []);

  async function refresh(id: string) {
    setError(null);
    const res = await apiFetch<Document[]>(`/employees/${id}/documents`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setDocuments(null);
      return;
    }
    setDocuments(res.data);
  }

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (employeeId) refresh(employeeId);
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);
    if (!employeeId) {
      setUploadError("Select an employee first.");
      return;
    }
    if (!file) {
      setUploadError("Choose a file first.");
      return;
    }
    const form = new FormData();
    form.set("docType", docType);
    form.set("file", file);
    const res = await apiFetch(`/employees/${employeeId}/documents`, {
      method: "POST",
      body: form,
    });
    if (res.error) {
      setUploadError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setFile(null);
    refresh(employeeId);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Employee documents (GET/POST /employees/:id/documents)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={lookup} className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Employee (self, or any if Admin/HR)</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
              >
                <option value="">Select an employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.role})</option>
                ))}
              </select>
            </div>
            <Button type="submit">List documents</Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <form onSubmit={upload} className="grid gap-3 border-t pt-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Doc type</Label>
              <Input value={docType} onChange={(e) => setDocType(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>File</Label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
                required
              />
            </div>
            {uploadError && <p className="text-sm text-destructive sm:col-span-3">{uploadError}</p>}
            <Button type="submit" className="w-fit sm:col-span-3">Upload</Button>
          </form>
        </CardContent>
      </Card>

      {documents && (
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {documents.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded border p-3 text-sm">
                <span>{d.docType}</span>
                <a href={d.fileUrl} target="_blank" rel="noreferrer" className="truncate text-primary underline">
                  {d.fileUrl}
                </a>
                <span className="text-xs text-muted-foreground">{new Date(d.uploadedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
